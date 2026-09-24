import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { InsertRefreshToken, RefreshTokenRepository, RefreshRecord } from '../../domain/port/index.js';
import { refreshTokens } from '../../db/schema.js';
import { refreshTokenStatusSchema, type FamilyId, type Jti, type Provider, type Timestamp, type UserId } from '../../domain/vo/index.js';

const toIso = (d: Date | string): Timestamp => (typeof d === 'string' ? d : d.toISOString());

const mapRefreshRow = (
  row: typeof refreshTokens.$inferSelect,
): RefreshRecord => ({
  jti: row.jti as Jti,
  tokenHash: row.tokenHash,
  userId: row.userId as UserId,
  familyId: row.familyId as FamilyId,
  provider: row.provider as Provider,
  status: row.status,
  expiresAt: toIso(row.expiresAt),
});

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  async findByRefreshTokenHash(tokenHash: string): Promise<RefreshRecord | null> {
    const row = this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get();
    return row ? mapRefreshRow(row) : null;
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
    this.db.update(refreshTokens).set({ status: refreshTokenStatusSchema.enum.used }).where(eq(refreshTokens.tokenHash, tokenHash)).run();
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    this.db.update(refreshTokens).set({ status: refreshTokenStatusSchema.enum.revoked }).where(eq(refreshTokens.tokenHash, tokenHash)).run();
  }

  async revokeFamily(familyId: FamilyId): Promise<void> {
    this.db.update(refreshTokens).set({ status: refreshTokenStatusSchema.enum.revoked }).where(eq(refreshTokens.familyId, familyId)).run();
  }

  async revokeAllForUser(userId: UserId): Promise<void> {
    this.db.update(refreshTokens).set({ status: refreshTokenStatusSchema.enum.revoked }).where(eq(refreshTokens.userId, userId)).run();
  }
}