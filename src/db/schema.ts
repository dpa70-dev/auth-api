import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Schema 1:1 con docs/04-modelo-de-datos.md (ERD + DDL aprobados en fase 2).
 * STRICT en SQLite se declara vía tableConfig: mejor mantener las CHECKs explícitas
 * que también protegen en modo legacy.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_google_sub_unique').on(t.googleSub),
    // doc 04 → users: CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL OR email_verified)
    // Un usuario creado por magic link prueba posesión del email (email_verified=1) sin
    // password_hash ni google_sub; un usuario local/google mantiene su vía de identidad.
    check(
      'users_identity_check',
      sql`${t.passwordHash} IS NOT NULL OR ${t.googleSub} IS NOT NULL OR ${t.emailVerified} = 1`,
    ),
  ],
);

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    jti: text('jti').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id').notNull(),
    familyId: text('family_id').notNull(),
    status: text('status', { enum: ['active', 'used', 'revoked'] }).notNull().default('active'),
    provider: text('provider', { enum: ['local', 'google', 'magic'] }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_id_idx').on(t.familyId),
    // doc 04 → refresh_tokens: CHECK (status IN ('active','used','revoked'))
    check('refresh_tokens_status_check', sql`${t.status} IN ('active','used','revoked')`),
    // doc 04 → refresh_tokens: CHECK (provider IN ('local','google','magic'))
    check('refresh_tokens_provider_check', sql`${t.provider} IN ('local','google','magic')`),
    // FK user_id y family_id → users.id (doc 04 → FK explícitas)
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.familyId], foreignColumns: [users.id] }).onDelete('cascade'),
  ],
);

export const magicLinks = sqliteTable(
  'magic_links',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    status: text('status', { enum: ['pending', 'used', 'revoked'] }).notNull().default('pending'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('magic_links_token_hash_unique').on(t.tokenHash),
    index('magic_links_email_idx').on(t.email),
    index('magic_links_status_idx').on(t.status),
    // doc 04 → magic_links: CHECK (status IN ('pending','used','revoked'))
    check('magic_links_status_check', sql`${t.status} IN ('pending','used','revoked')`),
  ],
);