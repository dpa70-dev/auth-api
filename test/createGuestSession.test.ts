import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { CreateGuestSession } from '../src/app/useCases/createGuestSession.js';
import type { Logger, TokenIssuer } from '../src/domain/port/index.js';
import { providerSchema, userKindSchema, userIdSchema } from '../src/domain/vo/index.js';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';
import { JoseTokenService } from '../src/infra/tokens/joseTokenService.js';
import { SqliteUnitOfWork } from '../src/infra/db/sqliteUnitOfWork.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

describe('CreateGuestSession — US-15 cuenta anónima', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let users: DrizzleUserRepository;
  let uow: SqliteUnitOfWork;
  const now = new Date('2026-01-01T00:00:00.000Z');
  const tokens: TokenIssuer = new JoseTokenService(new TextEncoder().encode('test-secret-para-guest-create-00'), 15);

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    users = new DrizzleUserRepository(db);
    uow = new SqliteUnitOfWork(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  const createGuestSession = () => new CreateGuestSession(users, tokens, uow, silentLogger);

  it('crea guest con email null, kind guest y sin identidad', async () => {
    const result = await createGuestSession().execute({ refreshTtlDays: 30, now });

    const user = await users.findById(userIdSchema.parse(result.user.id));
    expect(user).not.toBeNull();
    expect(user!.email).toBeNull();
    expect(user!.kind).toBe(userKindSchema.enum.guest);
    expect(user!.passwordHash).toBeNull();
    expect(user!.googleSub).toBeNull();
    expect(user!.emailVerified).toBe(false);
  });

  it('emite sesión con provider guest y el user del payload coincide', async () => {
    const result = await createGuestSession().execute({ refreshTtlDays: 30, now });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBeNull();
    expect(result.user.kind).toBe(userKindSchema.enum.guest);
    expect(result.user.createdAt).toBe(now.toISOString());

    const refresh = await users.findByRefreshTokenHash(
      await tokens.hashRefreshToken(result.refreshToken),
    );
    expect(refresh).not.toBeNull();
    expect(refresh!.userId).toBe(userIdSchema.parse(result.user.id));
    expect(refresh!.provider).toBe(providerSchema.enum.guest);
  });

  it('dos requests → dos guest distintos (sin dedup ni link a identidad previa)', async () => {
    const uc = createGuestSession();
    const first = await uc.execute({ refreshTtlDays: 30, now });
    const second = await uc.execute({ refreshTtlDays: 30, now });

    expect(first.user.id).not.toBe(second.user.id);
    const a = await users.findById(userIdSchema.parse(first.user.id));
    const b = await users.findById(userIdSchema.parse(second.user.id));
    expect(a!.kind).toBe(userKindSchema.enum.guest);
    expect(b!.kind).toBe(userKindSchema.enum.guest);
    expect(a!.email).toBeNull();
    expect(b!.email).toBeNull();
  });
});