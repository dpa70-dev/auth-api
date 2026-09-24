import type { Config } from '../config.js';
import type { TokenIssuer, UserRepository } from '../domain/port/index.js';

/** Dependencias de la frontera HTTP (doc 08 → sección 3): tokens para requireAuth,
 *  users para requireRole (rol leído por request, no embebido en el JWT), config para rate limit/ttl. */
export type ApiDeps = {
  tokens: TokenIssuer;
  users: UserRepository;
  config: Config;
};