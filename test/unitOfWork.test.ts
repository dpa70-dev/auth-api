import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { RegisterUser } from '../src/app/useCases/registerUser.js';
import type { CompromisedPasswordChecker, Logger, PasswordHasher, TokenIssuer } from '../src/domain/port/index.js';
import { emailSchema, familyIdSchema, jtiSchema, providerSchema, userIdSchema, userKindSchema, type Email, type PasswordHash, type PlainPassword } from '../src/domain/vo/index.js';
import { DrizzleUserRepository } from '../src/infra/drizzleUserRepository.js';
import { JoseTokenService } from '../src/infra/joseTokenService.js';
import { SqliteUnitOfWork } from '../src/infra/sqliteUnitOfWork.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };
/** Screen falso: ninguna contraseña está comprometida (los tests no pueden depender de la red). */
const noOpCompromisedChecker: CompromisedPasswordChecker = { check: async () => 'clean' };
/** Hasher falso: hash determinista >= 20 chars (mínimo de passwordHashSchema). */
const stubHasher: PasswordHasher = {
  hash: async (plain: PlainPassword): Promise<PasswordHash> => `stub-argon2-${plain}`.padEnd(20, 'x'),
  verify: async () => false,
};

const TEST_SECRET = 'test-secret-para-unit-of-work-000';
const testTokens: TokenIssuer = new JoseTokenService(new TextEncoder().encode(TEST_SECRET), 15);
const now = () => new Date().toISOString();
const emailOf = (s: string): Email => emailSchema.parse(s);

describe('SqliteUnitOfWork — commit/rollback (doc 13 → §13.1)', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let uow: SqliteUnitOfWork;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    uow = new SqliteUnitOfWork(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('persiste las escrituras del callback cuando todas tienen éxito (COMMIT)', async () => {
    const users = new DrizzleUserRepository(db);
    const id = userIdSchema.parse(randomUUID());

    await uow.withTransaction(async () => {
      await users.createUser({
        id,
        email: emailOf('commit@example.com'),
        passwordHash: await stubHasher.hash('secreta123' as PlainPassword),
        googleSub: null,
        emailVerified: false,
        kind: userKindSchema.enum.registered,
        createdAt: now(),
      });
      await users.insertRefreshToken({
        jti: jtiSchema.parse(randomUUID()),
        tokenHash: createHash('sha256').update('raw').digest('hex'),
        userId: id,
        familyId: familyIdSchema.parse(randomUUID()),
        provider: providerSchema.enum.local,
        expiresAt: now(),
      });
    });

    expect(await users.findByEmail(emailOf('commit@example.com'))).not.toBeNull();
    expect(sqlite.inTransaction).toBe(false);
  });

  it('revierte las escrituras previas si el callback lanza — sin estado parcial (ROLLBACK)', async () => {
    const users = new DrizzleUserRepository(db);
    const email = emailOf('rollback@example.com');

    await expect(
      uow.withTransaction(async () => {
        await users.createUser({
          id: userIdSchema.parse(randomUUID()),
          email,
          passwordHash: await stubHasher.hash('secreta123' as PlainPassword),
          googleSub: null,
          emailVerified: false,
          kind: userKindSchema.enum.registered,
          createdAt: now(),
        });
        // Segunda escritura falla (email duplicado → UniqueConstraintViolation en el repo).
        await users.createUser({
          id: userIdSchema.parse(randomUUID()),
          email,
          passwordHash: await stubHasher.hash('otra123' as PlainPassword),
          googleSub: null,
          emailVerified: false,
          kind: userKindSchema.enum.registered,
          createdAt: now(),
        });
      }),
    ).rejects.toThrow();

    expect(await users.findByEmail(email)).toBeNull();
    expect(sqlite.inTransaction).toBe(false);
  });

  it('rechaza transacciones anidadas', async () => {
    await expect(
      uow.withTransaction(async () => {
        await uow.withTransaction(async () => {});
      }),
    ).rejects.toThrow('transacción anidada');
    expect(sqlite.inTransaction).toBe(false);
  });
});

describe('RegisterUser — uso del UnitOfWork', () => {
  let sqlite: Database.Database;
  let db: BetterSQLite3Database;
  let uow: SqliteUnitOfWork;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    db = drizzle(sqlite);
    migrate(db, { migrationsFolder: './migrations' });
    uow = new SqliteUnitOfWork(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('NO deja usuario creado si el segundo write (insertRefreshToken) falla', async () => {
    const users = new DrizzleUserRepository(db);
    // Repo que falla SOLO en el insert del refresh — el createUser usa el repo real.
    const failingUsers = new (class extends DrizzleUserRepository {
      override async insertRefreshToken(): Promise<void> {
        throw new Error('forced failure on refresh insert');
      }
    })(db);

    const registerUser = new RegisterUser(failingUsers, stubHasher, noOpCompromisedChecker, testTokens, uow, silentLogger);

    await expect(
      registerUser.execute({
        email: emailOf('noparcial@example.com'),
        password: 'secreta123' as PlainPassword,
        refreshTtlDays: 15,
      }),
    ).rejects.toThrow('forced failure on refresh insert');

    expect(await users.findByEmail(emailOf('noparcial@example.com'))).toBeNull();
    expect(sqlite.inTransaction).toBe(false);
  });

  it('crea usuario + refresh token consistentemente cuando todo funciona', async () => {
    const users = new DrizzleUserRepository(db);
    const registerUser = new RegisterUser(users, stubHasher, noOpCompromisedChecker, testTokens, uow, silentLogger);

    const email = emailOf('completo@example.com');
    const result = await registerUser.execute({ email, password: 'secreta123' as PlainPassword, refreshTtlDays: 15 });

    expect(result.accessToken).toMatch(/^eyJ/);
    expect(result.refreshToken).toBeTruthy();
    expect((await users.findByEmail(email))?.id).toBe(result.user.id);
    expect(sqlite.inTransaction).toBe(false);
  });
});