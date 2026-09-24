import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { SetUserModerationStatus } from '../src/app/useCases/index.js';
import type { Logger, RefreshTokenRepository, UserRepository } from '../src/domain/port/index.js';
import {
  emailSchema,
  familyIdSchema,
  jtiSchema,
  providerSchema,
  refreshTokenStatusSchema,
  userIdSchema,
  userKindSchema,
  userRoleSchema,
  userStatusSchema,
  type Email,
  type UserId,
} from '../src/domain/vo/index.js';
import { DrizzleRefreshTokenRepository } from '../src/infra/db/drizzleRefreshTokenRepository.js';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

describe('SetUserModerationStatus — eje de moderación (doc 04 → users.status)', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let users: UserRepository;
  let refreshTokens: RefreshTokenRepository;
  const email = (s: string): Email => emailSchema.parse(s);

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    users = new DrizzleUserRepository(db);
    refreshTokens = new DrizzleRefreshTokenRepository(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  const setStatus = () => new SetUserModerationStatus(users, refreshTokens, silentLogger);

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

  const insertRefreshFor = async (userId: UserId): Promise<string> => {
    const tokenHash = createHash('sha256').update(randomUUID()).digest('hex');
    await refreshTokens.insertRefreshToken({
      jti: jtiSchema.parse(randomUUID()),
      tokenHash,
      userId,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.local,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    return tokenHash;
  };

  it('admin suspende a un user → status persistido y TODAS sus sesiones revocadas', async () => {
    const actorId = await insertUser('registered', 'admin');
    const targetId = await insertUser();
    const oldSession = await insertRefreshFor(targetId);
    const activeSession = await insertRefreshFor(targetId);

    const result = await setStatus().execute({ actorId, targetId, status: userStatusSchema.enum.suspended });

    expect(result).toEqual({ id: targetId, status: 'suspended' });
    const target = await users.findById(targetId);
    expect(target?.status).toBe(userStatusSchema.enum.suspended);
    const old = await refreshTokens.findByRefreshTokenHash(oldSession);
    const active = await refreshTokens.findByRefreshTokenHash(activeSession);
    expect(old?.status).toBe(refreshTokenStatusSchema.enum.revoked);
    expect(active?.status).toBe(refreshTokenStatusSchema.enum.revoked);
  });

  it('un-ban (banned → active) persiste el estado y NO revoca sesiones (no re-emite; el usuario re-autentica)', async () => {
    const actorId = await insertUser('registered', 'admin');
    const targetId = await insertUser();
    await users.setModerationStatus(targetId, userStatusSchema.enum.banned);
    const session = await insertRefreshFor(targetId);

    const result = await setStatus().execute({ actorId, targetId, status: userStatusSchema.enum.active });

    expect(result).toEqual({ id: targetId, status: 'active' });
    const target = await users.findById(targetId);
    expect(target?.status).toBe(userStatusSchema.enum.active);
    // Al volver a active NO se tocan las sesiones: la que existía (activa) sigue viva.
    const row = await refreshTokens.findByRefreshTokenHash(session);
    expect(row?.status).toBe(refreshTokenStatusSchema.enum.active);
  });

  it('actor sin rol admin → 403 FORBIDDEN', async () => {
    const actorId = await insertUser();
    const targetId = await insertUser();

    await expect(
      setStatus().execute({ actorId, targetId, status: userStatusSchema.enum.banned }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('usuario objetivo inexistente → 404 NOT_FOUND', async () => {
    const actorId = await insertUser('registered', 'admin');
    const ghost = userIdSchema.parse('00000000-0000-4000-8000-000000000000');

    await expect(
      setStatus().execute({ actorId, targetId: ghost, status: userStatusSchema.enum.suspended }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('actor inexistente + guard roto → 401 UNAUTHORIZED (defensivo)', async () => {
    const ghost = userIdSchema.parse('00000000-0000-4000-8000-000000000000');
    const targetId = await insertUser();

    await expect(
      setStatus().execute({ actorId: ghost, targetId, status: userStatusSchema.enum.suspended }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});