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
import {
  magicLinkPurposeSchema,
  magicLinkPurposeValues,
  magicLinkStatusSchema,
  magicLinkStatusValues,
  otpStatusValues,
  providerValues,
  refreshTokenStatusSchema,
  refreshTokenStatusValues,
  userKindValues,
} from '../domain/vo/index.js';

/**
 * Serie 'a', 'b' para CHECKs IN (...) — derivada en compilación del array fuente única.
 * Los values son literales const del dominio (no input): sql.raw es seguro acá.
 */
const inList = (values: readonly string[]): ReturnType<typeof sql.raw> =>
  // join sin espacio: reproduce byte-a-byte el SQL de las migraciones previas (snapshot estable).
  sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Schema 1:1 con docs/04-modelo-de-datos.md (ERD + DDL aprobados en fase 2).
 * STRICT en SQLite se declara vía tableConfig: mejor mantener las CHECKs explícitas
 * que también protegen en modo legacy.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    // email NULL para cuentas guest (US-15/16, doc 04 → users): la identidad se reclama
    // en el upgrade; los usuarios registrados siempre lo tienen.
    email: text('email'),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub'),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    // kind: tipo de cuenta (eje identidad, NO rol — doc 04 → users.kind). DEFAULT 'registered'
    // hace retrocompatible la migración: todas las filas preexistentes quedan registered.
    kind: text('kind', { enum: userKindValues }).notNull().default('registered'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(t.email),
    uniqueIndex('users_google_sub_unique').on(t.googleSub),
    // doc 04 → users: CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL OR email_verified = 1 OR kind = 'guest')
    // Un usuario creado por magic link/OTP prueba posesión del email (email_verified=1) sin
    // password_hash ni google_sub; un guest (US-15) existe sin identidad — la única excepción.
    check(
      'users_identity_check',
      sql`${t.passwordHash} IS NOT NULL OR ${t.googleSub} IS NOT NULL OR ${t.emailVerified} = 1 OR ${t.kind} = 'guest'`,
    ),
    // doc 04 → users.kind: CHECK derivado de userKindValues (fuente única)
    check('users_kind_check', sql`${t.kind} IN (${inList(userKindValues)})`),
  ],
);

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    jti: text('jti').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id').notNull(),
    familyId: text('family_id').notNull(),
    status: text('status', { enum: refreshTokenStatusValues }).notNull().default(refreshTokenStatusSchema.enum.active),
    provider: text('provider', { enum: providerValues }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_id_idx').on(t.familyId),
    // doc 04 → refresh_tokens: CHECK derivado de refreshTokenStatusValues
    check('refresh_tokens_status_check', sql`${t.status} IN (${inList(refreshTokenStatusValues)})`),
    // doc 04 → refresh_tokens: CHECK derivado de providerValues
    check('refresh_tokens_provider_check', sql`${t.provider} IN (${inList(providerValues)})`),
    // FK user_id → users.id (doc 04 → FK explícita); family_id sin FK (la familia es una sesión)
    foreignKey({ columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
  ],
);

export const magicLinks = sqliteTable(
  'magic_links',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    // purpose: login (US-09/10) o password_reset (US-12); 1:1 con el VO magicLinkPurpose.
    purpose: text('purpose', { enum: magicLinkPurposeValues }).notNull().default(magicLinkPurposeSchema.enum.login),
    status: text('status', { enum: magicLinkStatusValues }).notNull().default(magicLinkStatusSchema.enum.pending),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('magic_links_token_hash_unique').on(t.tokenHash),
    index('magic_links_email_idx').on(t.email),
    index('magic_links_status_idx').on(t.status),
    // doc 04 → magic_links: CHECK derivado de magicLinkStatusValues
    check('magic_links_status_check', sql`${t.status} IN (${inList(magicLinkStatusValues)})`),
    // doc 04 → magic_links: CHECK derivado de magicLinkPurposeValues
    check('magic_links_purpose_check', sql`${t.purpose} IN (${inList(magicLinkPurposeValues)})`),
  ],
);

export const otpCodes = sqliteTable(
  'otp_codes',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    // Solamente el hash argon2id del código se persiste (doc 00 → ítem 34).
    codeHash: text('code_hash').notNull(),
    status: text('status', { enum: otpStatusValues }).notNull().default('pending'),
    // Intentos inválidos acumulados; >= OTP_MAX_ATTEMPTS revoca el código.
    attempts: integer('attempts').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('otp_codes_email_idx').on(t.email),
    index('otp_codes_status_idx').on(t.status),
    // doc 04 → otp_codes: CHECK derivado de otpStatusValues
    check('otp_codes_status_check', sql`${t.status} IN (${inList(otpStatusValues)})`),
  ],
);