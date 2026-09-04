import type {
  EmailSender,
  GoogleIdTokenVerifier,
  Logger,
  MagicLinkRepository,
  PasswordHasher,
  TokenIssuer,
  UserRepository,
} from '../domain/port/index.js';

import { RegisterUser } from './registerUser.js';
import { Login } from './login.js';
import { RefreshTokens } from './refreshTokens.js';
import { Logout } from './logout.js';
import { LoginGoogle } from './loginGoogle.js';
import { RequestMagicLink } from './requestMagicLink.js';
import { ConsumeMagicLink } from './consumeMagicLink.js';

/** Puertos (interfaces de dominio) que los casos de uso necesitan para operar. */
export type UseCasePorts = {
  users: UserRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  magicLinks: MagicLinkRepository;
  sender: EmailSender;
  /** null ⇔ el verifier de Google no está disponible (ver GUIID en compose). */
  google: GoogleIdTokenVerifier | null;
};

export type UseCases = {
  registerUser: RegisterUser;
  login: Login;
  refreshTokens: RefreshTokens;
  logout: Logout;
  requestMagicLink: RequestMagicLink;
  consumeMagicLink: ConsumeMagicLink;
  /** null ⇔ GOOGLE_CLIENT_ID no configurado: la ruta existe pero responde 500 explícito. */
  loginGoogle: LoginGoogle | null;
};

/**
 * Compone los casos de uso de la capa de aplicación a partir de los puertos.
 * Los casos de uso son orquestación de negocio (capa application) — se construyen aquí, no
 * en infra, que solo instancia implementaciones externas. La sesión se ensambla en index.ts.
 */
export const buildUseCases = (
  { users, hasher, tokens, magicLinks, sender, google }: UseCasePorts,
  logger: Logger,
): UseCases => ({
  registerUser: new RegisterUser(users, hasher, tokens, logger),
  login: new Login(users, hasher, tokens, logger),
  refreshTokens: new RefreshTokens(users, tokens, logger),
  logout: new Logout(users, tokens, logger),
  requestMagicLink: new RequestMagicLink(magicLinks, tokens, sender, logger),
  consumeMagicLink: new ConsumeMagicLink(users, magicLinks, tokens, logger),
  loginGoogle: google === null ? null : new LoginGoogle(users, google, tokens, logger),
});
