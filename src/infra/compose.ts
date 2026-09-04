import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { config as appConfig, type Config } from '../config.js';
import type { EmailSender, GoogleIdTokenVerifier, Logger, MagicLinkRepository } from '../domain/port/index.js';
import { Argon2PasswordHasher } from './argon2PasswordHasher.js';
import { JoseTokenService } from './joseTokenService.js';
import { DrizzleUserRepository } from './drizzleUserRepository.js';
import { DrizzleMagicLinkRepository } from './drizzleMagicLinkRepository.js';
import { ConsoleEmailSender } from './consoleEmailSender.js';
import { GoogleIdTokenVerifierJose } from './googleJwtVerifier.js';
import { PinoLogger } from './pinoLogger.js';

import type { PasswordHasher, TokenIssuer, UserRepository } from '../domain/port/index.js';

/** Dependencias externas que un consumidor (tests, CLI) puede inyectar en lugar de las reales. */
export type ComposeOverrides = {
  db?: Database.Database;
  google?: GoogleIdTokenVerifier | null;
  logger?: Logger;
  magicLinks?: MagicLinkRepository;
  sender?: EmailSender;
};

export type InfraPorts = {
  users: UserRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  google: GoogleIdTokenVerifier | null;
  magicLinks: MagicLinkRepository;
  sender: EmailSender;
  logger: Logger;
  close: () => void;
};

/**
 * Capa infraestructura: instancia las implementaciones reales de los puertos a partir de la
 * configuración, respetando los sobre-rides (db, google, logger) para tests. No construye los
 * casos de uso (eso es la capa application, app/useCases.ts) ni ensambla la app (eso es index.ts).
 */
export const composeInfra = (overrides: ComposeOverrides = {}, cfg: Config = appConfig): InfraPorts => {
  const rawLogger = new PinoLogger(cfg.nodeEnv);
  const logger = overrides.logger ?? rawLogger;

  const sqlite = overrides.db ?? new Database(cfg.dbPath, { fileMustExist: false });
  sqlite.pragma('foreign_keys = ON'); // doc 04 → FK activas
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './migrations' });

  const hasher = new Argon2PasswordHasher();
  const tokens = new JoseTokenService(new TextEncoder().encode(cfg.jwtSecret), cfg.accessTtlMinutes);
  const users = new DrizzleUserRepository(db);
  const magicLinks = overrides.magicLinks ?? new DrizzleMagicLinkRepository(db);
  const sender = overrides.sender ?? new ConsoleEmailSender(logger);
  const google = overrides.google !== undefined
    ? overrides.google
    : cfg.google.clientId !== undefined
      ? new GoogleIdTokenVerifierJose(cfg.google.clientId, cfg.google.issuer, cfg.google.jwksUrl)
      : null;

  return { users, hasher, tokens, google, magicLinks, sender, logger, close: () => sqlite.close() };
};
