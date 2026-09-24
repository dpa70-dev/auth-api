import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { SetUserRole } from '../src/app/useCases/index.js';
import type { Logger, UserRepository } from '../src/domain/port/index.js';
import { emailSchema, userIdSchema, userKindSchema, userRoleSchema, userStatusSchema, type Email, type UserId } from '../src/domain/vo/index.js';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

describe('SetUserRole — eje de autorización (US-??, doc 04 → users.role)', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let users: UserRepository;
  const email = (s: string): Email => emailSchema.parse(s);

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    users = new DrizzleUserRepository(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  const setRole = () => new SetUserRole(users, silentLogger);

  const insertUser = async (kind: 'registered' | 'guest' = 'registered', role: 'user' | 'admin' = 'user'): Promise<UserId> => {
    const id = userIdSchema.parse(randomUUID());
    await users.createUser({
      id,
      email: kind === 'registered' ? email(`u-${id}@example.com`) : null,
      passwordHash: kind === 'registered' ? 'argon2id-hash-ejemplo' : null,
      googleSub: null,
      emailVerified: kind === 'registered',
      kind: kind === 'registered' ? userKindSchema.enum.registered : userKindSchema.enum.guest,
      role: role === 'admin' ? userRoleSchema.enum.admin : userRoleSchema.enum.user,
      status: userStatusSchema.enum.active,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    return id;
  };

  it('admin promueve a un user → rol persistido admin', async () => {
    const actorId = await insertUser('registered', 'admin');
    const targetId = await insertUser();

    await setRole().execute({ actorId, targetId, role: userRoleSchema.enum.admin });

    const target = await users.findById(targetId);
    expect(target).not.toBeNull();
    expect(target!.role).toBe(userRoleSchema.enum.admin);
  });

  it('admin degrada a un admin → rol persistido user (transiciones libres, sin irreversibilidad)', async () => {
    const actorId = await insertUser('registered', 'admin');
    const targetId = await insertUser('registered', 'admin');

    await setRole().execute({ actorId, targetId, role: userRoleSchema.enum.user });

    const target = await users.findById(targetId);
    expect(target!.role).toBe(userRoleSchema.enum.user);
  });

  it('actor sin rol admin → 403 FORBIDDEN', async () => {
    const actorId = await insertUser();
    const targetId = await insertUser();

    await expect(
      setRole().execute({ actorId, targetId, role: userRoleSchema.enum.admin }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('auto-rol (actorId === targetId) → 403 FORBIDDEN aunque sea admin (no dejar sin admins)', async () => {
    const actorId = await insertUser('registered', 'admin');

    await expect(
      setRole().execute({ actorId, targetId: actorId, role: userRoleSchema.enum.user }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('usuario objetivo inexistente → 404 NOT_FOUND', async () => {
    const actorId = await insertUser('registered', 'admin');
    const ghost = userIdSchema.parse('00000000-0000-4000-8000-000000000000');

    await expect(
      setRole().execute({ actorId, targetId: ghost, role: userRoleSchema.enum.admin }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('actor inexistente + guard roto → 401 UNAUTHORIZED (defensivo)', async () => {
    const ghost = userIdSchema.parse('00000000-0000-4000-8000-000000000000');
    const targetId = await insertUser();

    await expect(
      setRole().execute({ actorId: ghost, targetId, role: userRoleSchema.enum.admin }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});