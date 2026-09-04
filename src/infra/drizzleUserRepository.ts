import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type {
  InsertRefreshToken,
  UserRecord,
  UserRepository,
} from '../domain/port/index.js';
import { refreshTokens, users } from '../db/schema.js';
import type { Email, GoogleSub, Jti, PasswordHash, Provider, RefreshTokenStatus, Timestamp, UserId } from '../domain/vo/index.js';
import { UniqueConstraintViolation } from '../domain/uniqueConstraintViolation.js';

const toIso = (d: Date | string): Timestamp => (typeof d === 'string' ? d : d.toISOString());

const mapUserRow = (row: typeof users.$inferSelect): UserRecord => ({
  id: row.id as UserId,
  email: row.email as Email,
  passwordHash: row.passwordHash as PasswordHash | null,
  googleSub: row.googleSub as GoogleSub | null,
  emailVerified: row.emailVerified,
  createdAt: toIso(row.createdAt),
});

const mapRefreshRow = (
  row: typeof refreshTokens.$inferSelect,
): {
  jti: Jti;
  tokenHash: string;
  userId: UserId;
  provider: Provider;
  status: RefreshTokenStatus;
  expiresAt: Timestamp;
} => ({
  jti: row.jti as Jti,
  tokenHash: row.tokenHash,
  userId: row.userId as UserId,
  provider: row.provider as Provider,
  status: row.status,
  expiresAt: toIso(row.expiresAt),
});

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  async findByEmail(email: Email): Promise<UserRecord | null> {
    const row = this.db.select().from(users).where(eq(users.email, email)).get();
    return row ? mapUserRow(row) : null;
  }

  async findByGoogleSub(sub: GoogleSub): Promise<UserRecord | null> {
    const row = this.db.select().from(users).where(eq(users.googleSub, sub)).get();
    return row ? mapUserRow(row) : null;
  }

  async findById(id: UserId): Promise<UserRecord | null> {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ? mapUserRow(row) : null;
  }

  async findByRefreshTokenHash(tokenHash: string): Promise<RefreshRecord | null> {
    const row = this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get();
    return row ? mapRefreshRow(row) : null;
  }

  async createUser(input: {
    id: UserId;
    email: Email;
    passwordHash: PasswordHash | null;
    googleSub: GoogleSub | null;
    emailVerified: boolean;
    createdAt: Timestamp;
  }): Promise<void> {
    try {
      this.db.insert(users).values({
        id: input.id,
        email: input.email,
        passwordHash: input.passwordHash,
        googleSub: input.googleSub,
        emailVerified: input.emailVerified,
        createdAt: input.createdAt,
      }).run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE|SQLITE_CONSTRAINT/i.test(err.message)) {
        // El dialecto de SQL vive en la infra; el dominio solo entiende UniqueConstraintViolation (DIP).
        throw new UniqueConstraintViolation(err);
      }
      throw err;
    }
  }

  async insertRefreshToken(token: InsertRefreshToken): Promise<void> {
    this.db.insert(refreshTokens).values({
      jti: token.jti,
      tokenHash: token.tokenHash,
      userId: token.userId,
      familyId: token.familyId,
      provider: token.provider,
      expiresAt: toIso(token.expiresAt),
      createdAt: new Date().toISOString(),
    }).run();
  }

  async markRefreshTokenUsed(tokenHash: string): Promise<void> {
    this.db.update(refreshTokens).set({ status: 'used' }).where(eq(refreshTokens.tokenHash, tokenHash)).run();
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    this.db.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.tokenHash, tokenHash)).run();
  }

  async revokeFamily(userId: UserId): Promise<void> {
    // familia = user_id (decisión 2, doc 04): revocar todos los refresh del usuario.
    this.db.update(refreshTokens).set({ status: 'revoked' }).where(eq(refreshTokens.familyId, userId)).run();
  }

  async markEmailVerified(email: Email): Promise<void> {
    this.db.update(users).set({ emailVerified: true }).where(eq(users.email, email)).run();
  }
}

type RefreshRecord = NonNullable<Awaited<ReturnType<UserRepository['findByRefreshTokenHash']>>>;