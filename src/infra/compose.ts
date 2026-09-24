import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { config as appConfig, type Config } from '../config.js';
import type { CompromisedPasswordChecker, EmailSender, GoogleIdTokenVerifier, Logger, MagicLinkRepository, OtpRepository, RefreshTokenRepository, UnitOfWork } from '../domain/port/index.js';
import { Argon2PasswordHasher } from './hashing/argon2PasswordHasher.js';
import { CompositeCompromisedPasswordChecker } from './compromised/compositeCompromisedPasswordChecker.js';
import { HibpCompromisedPasswordChecker } from './compromised/hibpCompromisedPasswordChecker.js';
import { LocalCompromisedPasswordChecker } from './compromised/localCompromisedPasswordChecker.js';
import { JoseTokenService } from './tokens/joseTokenService.js';
import { DrizzleUserRepository } from './db/drizzleUserRepository.js';
import { DrizzleRefreshTokenRepository } from './db/drizzleRefreshTokenRepository.js';
import { DrizzleMagicLinkRepository } from './db/drizzleMagicLinkRepository.js';
import { DrizzleOtpRepository } from './db/drizzleOtpRepository.js';
import { ConsoleEmailSender } from './outbound/consoleEmailSender.js';
import { GoogleIdTokenVerifierJose } from './tokens/googleJwtVerifier.js';
import { PinoLogger } from './outbound/pinoLogger.js';
import { SqliteUnitOfWork } from './db/sqliteUnitOfWork.js';

import type { PasswordHasher, TokenIssuer, UserRepository } from '../domain/port/index.js';

/** Dependencias externas que un consumidor (tests, CLI) puede inyectar en lugar de las reales. */
export type ComposeOverrides = {
  db?: Database.Database;
  google?: GoogleIdTokenVerifier | null;
  logger?: Logger;
  magicLinks?: MagicLinkRepository;
  sender?: EmailSender;
  unitOfWork?: UnitOfWork;
  /** Fake del screen de filtraciones (tests) — por defecto HIBP real. */
  compromised?: CompromisedPasswordChecker;
  refreshTokens?: RefreshTokenRepository;
};

export type InfraPorts = {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  google: GoogleIdTokenVerifier | null;
  magicLinks: MagicLinkRepository;
  otpCodes: OtpRepository;
  sender: EmailSender;
  compromised: CompromisedPasswordChecker;
  /** Unit of Work (doc 13 → §13.1): transacción atómica de escrituras. */
  unitOfWork: UnitOfWork;
  logger: Logger;
  close: () => void;
};

/**
 * Capa infraestructura: instancia las implementaciones reales de los puertos a partir de la
 * configuración, respetando los sobre-rides (db, google, logger) para tests. No construye los
 * casos de uso (eso es la capa application, app/buildUseCases.ts) ni ensambla la app (eso es index.ts).
 */
export const composeInfra = (overrides: ComposeOverrides = {}, cfg: Config = appConfig): InfraPorts => {
  const rawLogger = new PinoLogger(cfg.nodeEnv);
  const logger = overrides.logger ?? rawLogger;

  const sqlite = overrides.db ?? new Database(cfg.dbPath, { fileMustExist: false });
  sqlite.pragma('foreign_keys = ON'); // doc 04 → FK activas
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './migrations' });

  const hasher = new Argon2PasswordHasher();
  // Screen de filtraciones: HIBP online con fallback local (NIST §5.1.1.2). Un outage de HIBP
  // degrada a la lista embebida + top-100k + patrones — nunca bloquea el alta (fail-open en el composite).
  const compromised = overrides.compromised
    ?? new CompositeCompromisedPasswordChecker(
      new HibpCompromisedPasswordChecker(logger),
      new LocalCompromisedPasswordChecker(logger, cfg.localPasswordListPath),
      logger,
    );
  const tokens = new JoseTokenService(new TextEncoder().encode(cfg.jwtSecret), cfg.accessTtlMinutes);
  const users = new DrizzleUserRepository(db);
  const refreshTokens = overrides.refreshTokens ?? new DrizzleRefreshTokenRepository(db);
  const magicLinks = overrides.magicLinks ?? new DrizzleMagicLinkRepository(db);
  const otpCodes = new DrizzleOtpRepository(db);
  const sender = overrides.sender ?? new ConsoleEmailSender(logger);
  const google = overrides.google !== undefined
    ? overrides.google
    : cfg.google.clientId !== undefined
      ? new GoogleIdTokenVerifierJose(cfg.google.clientId, cfg.google.issuer, cfg.google.jwksUrl)
      : null;
  const unitOfWork = overrides.unitOfWork ?? new SqliteUnitOfWork(sqlite);

  return { users, refreshTokens, hasher, tokens, google, magicLinks, otpCodes, sender, compromised, unitOfWork, logger, close: () => sqlite.close() };
};
