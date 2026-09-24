import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Server } from 'node:http';
import { buildApp } from '../src/index.js';
import type { CompromisedPasswordChecker, Logger } from '../src/domain/port/index.js';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';
import { emailSchema, type Email } from '../src/domain/vo/index.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
const noOpCompromisedChecker: CompromisedPasswordChecker = { check: async () => 'clean' };

type AuthData = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string | null; kind: 'registered' | 'guest'; createdAt: string };
};
type ErrorData = { code: string; message: string; requestId: string; details?: { field: string; issue: string }[] };
const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

type TestContext = { baseUrl: string; close: () => Promise<void>; adminToken: string; userToken: string; targetId: string };

/** Levanta la app con DB propia en :memory: y siembra: un target (user), un user normal y un admin. */
const startApp = async (): Promise<TestContext> => {
  const sqlite = new Database(':memory:');
  const { app, close } = buildApp({ db: sqlite, google: null, logger: silentLogger, compromised: noOpCompromisedChecker });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const db = drizzle(sqlite);
  const users = new DrizzleUserRepository(db);

  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  // Usuario A (target): se registra normalmente → nace role user.
  const targetRes = await post(`${baseUrl}/auth/register`, { email: 'target@example.com', password: 'contraseñaSegura123' });
  expect(targetRes.status).toBe(201);
  const { data: targetData } = await readJson<{ data: AuthData }>(targetRes);

  // Usuario B (user normal): token para probar requireRole → 403.
  const userRes = await post(`${baseUrl}/auth/register`, { email: 'normal@example.com', password: 'contraseñaSegura123' });
  const { data: userData } = await readJson<{ data: AuthData }>(userRes);

  // Usuario C (admin): se registra y se PROMUEVE en DB (no hay endpoint público para auto-admin).
  await post(`${baseUrl}/auth/register`, { email: 'admin@example.com', password: 'contraseñaSegura123' });
  const adminEmail: Email = emailSchema.parse('admin@example.com');
  const adminRow = await users.findByEmail(adminEmail);
  if (!adminRow) throw new Error('admin no sembrado');
  await users.setRole(adminRow.id, 'admin');
  const adminLogin = await post(`${baseUrl}/auth/login`, { email: 'admin@example.com', password: 'contraseñaSegura123' });
  const { data: adminData } = await readJson<{ data: AuthData }>(adminLogin);

  return {
    baseUrl,
    adminToken: adminData.accessToken,
    userToken: userData.accessToken,
    targetId: targetData.user.id,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          close();
          resolve();
        });
      }),
  };
};

const patch = (url: string, body: unknown, token?: string) =>
  fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

let ctx: TestContext;
beforeEach(async () => {
  ctx = await startApp();
});
afterEach(async () => {
  await ctx.close();
});

describe('PATCH /admin/users/:id/role — eje de autorización', () => {
  it('204 sin cuerpo al promover (admin) y el rol persiste', async () => {
    const res = await patch(`${ctx.baseUrl}/admin/users/${ctx.targetId}/role`, { role: 'admin' }, ctx.adminToken);
    expect(res.status).toBe(204);
    expect((await res.text()).length).toBe(0);

    const me = await fetch(`${ctx.baseUrl}/auth/me`, { headers: { authorization: `Bearer ${ctx.adminToken}` } });
    expect(me.status).toBe(200);
  });

  it('401 UNAUTHORIZED sin token', async () => {
    const res = await patch(`${ctx.baseUrl}/admin/users/${ctx.targetId}/role`, { role: 'admin' });
    expect(res.status).toBe(401);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('403 FORBIDDEN con token de un user normal (requireRole en acción)', async () => {
    const res = await patch(`${ctx.baseUrl}/admin/users/${ctx.targetId}/role`, { role: 'admin' }, ctx.userToken);
    expect(res.status).toBe(403);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('403 FORBIDDEN al intentar auto-rol (actor === target)', async () => {
    const me = await fetch(`${ctx.baseUrl}/auth/me`, { headers: { authorization: `Bearer ${ctx.adminToken}` } });
    const { data } = await readJson<{ data: { id: string } }>(me);
    const res = await patch(`${ctx.baseUrl}/admin/users/${data.id}/role`, { role: 'user' }, ctx.adminToken);
    expect(res.status).toBe(403);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('404 NOT_FOUND si el usuario objetivo no existe', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const res = await patch(`${ctx.baseUrl}/admin/users/${ghost}/role`, { role: 'admin' }, ctx.adminToken);
    expect(res.status).toBe(404);
  });

  it('422 VALIDATION_ERROR con role inválido', async () => {
    const res = await patch(`${ctx.baseUrl}/admin/users/${ctx.targetId}/role`, { role: 'superadmin' }, ctx.adminToken);
    expect(res.status).toBe(422);
    const { error } = await readJson<{ error: ErrorData }>(res);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('422 VALIDATION_ERROR con id no-UUID', async () => {
    const res = await patch(`${ctx.baseUrl}/admin/users/not-a-uuid/role`, { role: 'admin' }, ctx.adminToken);
    expect(res.status).toBe(422);
  });
});