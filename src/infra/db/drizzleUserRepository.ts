import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { UserRecord, UserRepository } from '../../domain/port/index.js';
import { users } from '../../db/schema.js';
import { userKindSchema, type Email, type GoogleSub, type PasswordHash, type Timestamp, type UserId, type UserRole, type UserStatus } from '../../domain/vo/index.js';
import { userSchema, type NewUser } from '../../domain/entity/user.js';
import { UniqueConstraintViolation } from '../../domain/uniqueConstraintViolation.js';

const mapUserRow = (row: typeof users.$inferSelect): UserRecord =>
  // userSchema valida la invariante de la entidad al entrar (email obligatorio para non-guest,
  // kind ∈ {registered, guest}) — filas corruptas no llegan al dominio.
  userSchema.parse(row);

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

  async createUser(input: NewUser & { createdAt: Timestamp }): Promise<void> {
    try {
      this.db.insert(users).values({
        id: input.id,
        email: input.email,
        passwordHash: input.passwordHash,
        googleSub: input.googleSub,
        emailVerified: input.emailVerified,
        kind: input.kind,
        role: input.role,
        status: input.status,
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

  async markEmailVerified(email: Email): Promise<void> {
    this.db.update(users).set({ emailVerified: true }).where(eq(users.email, email)).run();
  }

  async updatePasswordHash(userId: UserId, passwordHash: PasswordHash): Promise<void> {
    this.db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
  }

  async upgradeGuestToRegistered(userId: UserId, email: Email, passwordHash: PasswordHash): Promise<void> {
    try {
      this.db.update(users).set({ email, passwordHash, kind: userKindSchema.enum.registered }).where(eq(users.id, userId)).run();
    } catch (err) {
      if (err instanceof Error && /UNIQUE|SQLITE_CONSTRAINT/i.test(err.message)) {
        throw new UniqueConstraintViolation(err);
      }
      throw err;
    }
  }

  async setRole(userId: UserId, role: UserRole): Promise<void> {
    this.db.update(users).set({ role }).where(eq(users.id, userId)).run();
  }

  async setModerationStatus(userId: UserId, status: UserStatus): Promise<void> {
    this.db.update(users).set({ status }).where(eq(users.id, userId)).run();
  }
}