import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';
import type { MagicLinkRecord, MagicLinkRepository } from '../domain/port/index.js';
import { magicLinks } from '../db/schema.js';
import type { Email, MagicLinkStatus, Timestamp } from '../domain/vo/index.js';

const toIso = (d: Date | string): Timestamp => (typeof d === 'string' ? d : d.toISOString());

const mapRow = (row: typeof magicLinks.$inferSelect): MagicLinkRecord => ({
  id: row.id,
  tokenHash: row.tokenHash,
  email: row.email as Email,
  status: row.status as MagicLinkStatus,
  expiresAt: toIso(row.expiresAt),
});

export class DrizzleMagicLinkRepository implements MagicLinkRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  async insert(input: {
    id: string;
    tokenHash: string;
    email: Email;
    expiresAt: Timestamp;
  }): Promise<void> {
    this.db.insert(magicLinks).values({
      id: input.id,
      tokenHash: input.tokenHash,
      email: input.email,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    }).run();
  }

  async findByTokenHash(tokenHash: string): Promise<MagicLinkRecord | null> {
    const row = this.db.select().from(magicLinks).where(eq(magicLinks.tokenHash, tokenHash)).get();
    return row ? mapRow(row) : null;
  }

  async markUsed(tokenHash: string): Promise<void> {
    this.db.update(magicLinks).set({ status: 'used' }).where(eq(magicLinks.tokenHash, tokenHash)).run();
  }

  async revokeAllForEmail(email: Email): Promise<void> {
    this.db
      .update(magicLinks)
      .set({ status: 'revoked' })
      .where(and(eq(magicLinks.email, email), eq(magicLinks.status, 'pending')))
      .run();
  }
}