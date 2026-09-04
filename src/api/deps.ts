import type { Config } from '../config.js';
import type { TokenIssuer, UserRepository } from '../domain/port/index.js';

/** Dependencias de la frontera HTTP: mismas que recibe el router (routes.ts). */
export type ApiDeps = {
  tokens: TokenIssuer;
  users: UserRepository;
  config: Config;
};