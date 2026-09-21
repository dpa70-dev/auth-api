import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { OtpRecord, OtpRepository } from '../../domain/port/index.js';
import { otpCodes } from '../../db/schema.js';
import type { Email, OtpStatus, PasswordHash, Timestamp } from '../../domain/vo/index.js';
import { otpStatusSchema } from '../../domain/vo/index.js';

const toIso = (d: Date | string): Timestamp => (typeof d === 'string' ? d : d.toISOString());

const mapRow = (row: typeof otpCodes.$inferSelect): OtpRecord => ({
  id: row.id,
  email: row.email as Email,
  codeHash: row.codeHash as PasswordHash,
  status: row.status as OtpStatus,
  attempts: row.attempts,
  expiresAt: toIso(row.expiresAt),
  createdAt: toIso(row.createdAt),
});

export class DrizzleOtpRepository implements OtpRepository {
  constructor(private readonly db: BetterSQLite3Database) {}

  async insert(input: {
    id: string;
    email: Email;
    codeHash: PasswordHash;
    expiresAt: Timestamp;
  }): Promise<void> {
    this.db.insert(otpCodes).values({
      id: input.id,
      email: input.email,
      codeHash: input.codeHash,
      status: otpStatusSchema.enum.pending,
      attempts: 0,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    }).run();
  }

  async findPendingByEmail(email: Email, nowIso: string): Promise<OtpRecord | null> {
    const row = this.db
      .select()
      .from(otpCodes)
      .where(and(
        eq(otpCodes.email, email),
        eq(otpCodes.status, otpStatusSchema.enum.pending),
        gt(otpCodes.expiresAt, nowIso),
      ))
      .get();
    return row ? mapRow(row) : null;
  }

  async revokeAllForEmail(email: Email): Promise<void> {
    this.db
      .update(otpCodes)
      .set({ status: otpStatusSchema.enum.revoked })
      .where(and(eq(otpCodes.email, email), eq(otpCodes.status, otpStatusSchema.enum.pending)))
      .run();
  }

  async markStatus(id: string, status: OtpStatus): Promise<void> {
    this.db.update(otpCodes).set({ status }).where(eq(otpCodes.id, id)).run();
  }

  async incrementAttempts(id: string): Promise<void> {
    this.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id))
      .run();
  }
}