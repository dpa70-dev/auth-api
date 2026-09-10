import type {
  CompromisedPasswordChecker,
  EmailSender,
  GoogleIdTokenVerifier,
  Logger,
  MagicLinkRepository,
  PasswordHasher,
  TokenIssuer,
  UserRepository,
} from '../domain/port/index.js';

import {
  RegisterUser,
  Login,
  RefreshTokens,
  Logout,
  LoginGoogle,
  RequestMagicLink,
  ConsumeMagicLink,
  GetMe,
  ChangePassword,
  ResetPassword,
} from './useCases/index.js';

/** Puertos (interfaces de dominio) que los casos de uso necesitan para operar. */
export type Ports = {
  users: UserRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  magicLinks: MagicLinkRepository;
  sender: EmailSender;
  /** Screen NIST 800-63B §5.1.1.2 contra contraseñas comprometidas (HIBP en prod, fake en tests). */
  compromised: CompromisedPasswordChecker;
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
  me: GetMe;
  changePassword: ChangePassword;
  resetPassword: ResetPassword;
  /** null ⇔ GOOGLE_CLIENT_ID no configurado: la ruta existe pero responde 500 explícito. */
  loginGoogle: LoginGoogle | null;
};

/**
 * Compone los casos de uso de la capa de aplicación a partir de los puertos.
 * Los casos de uso son orquestación de negocio (capa application) — se construyen aquí, no
 * en infra, que solo instancia implementaciones externas. La sesión se ensambla en index.ts.
 */
export const buildUseCases = (
  { users, hasher, tokens, magicLinks, sender, compromised, google }: Ports,
  logger: Logger,
): UseCases => ({
  registerUser: new RegisterUser(users, hasher, compromised, tokens, logger),
  login: new Login(users, hasher, tokens, logger),
  refreshTokens: new RefreshTokens(users, tokens, logger),
  logout: new Logout(users, tokens, logger),
  requestMagicLink: new RequestMagicLink(magicLinks, tokens, sender, logger),
  consumeMagicLink: new ConsumeMagicLink(users, magicLinks, tokens, logger),
  me: new GetMe(users, logger),
  changePassword: new ChangePassword(users, hasher, compromised, logger),
  resetPassword: new ResetPassword(users, magicLinks, hasher, compromised, tokens, logger),
  loginGoogle: google === null ? null : new LoginGoogle(users, google, tokens, logger),
});
