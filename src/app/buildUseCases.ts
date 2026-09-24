import type {
  CompromisedPasswordChecker,
  EmailSender,
  GoogleIdTokenVerifier,
  Logger,
  MagicLinkRepository,
  OtpRepository,
  PasswordHasher,
  RefreshTokenRepository,
  TokenIssuer,
  UnitOfWork,
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
  RequestOtp,
  VerifyOtp,
  CreateGuestSession,
  UpgradeGuestAccount,
  SetUserRole,
} from './useCases/index.js';

/** Puertos (interfaces de dominio) que los casos de uso necesitan para operar. */
export type Ports = {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  magicLinks: MagicLinkRepository;
  otpCodes: OtpRepository;
  sender: EmailSender;
  /** Screen NIST 800-63B §5.1.1.2 contra contraseñas comprometidas (HIBP en prod, fake en tests). */
  compromised: CompromisedPasswordChecker;
  /** null ⇔ el verifier de Google no está disponible (ver GUIID en compose). */
  google: GoogleIdTokenVerifier | null;
  /** Unit of Work (doc 13 → §13.1): los UCs transaccionales envuelven sus escrituras atómicamente. */
  unitOfWork: UnitOfWork;
};

export type UseCases = {
  registerUser: RegisterUser;
  login: Login;
  refreshTokens: RefreshTokens;
  logout: Logout;
  requestMagicLink: RequestMagicLink;
  consumeMagicLink: ConsumeMagicLink;
  requestOtp: RequestOtp;
  verifyOtp: VerifyOtp;
  me: GetMe;
  changePassword: ChangePassword;
  resetPassword: ResetPassword;
  createGuestSession: CreateGuestSession;
  upgradeGuestAccount: UpgradeGuestAccount;
  /** Admin: asigna rol (defensa extra de requireRole; verifica actor + prohíbe auto-rol). */
  setUserRole: SetUserRole;
  /** null ⇔ GOOGLE_CLIENT_ID no configurado: la ruta existe pero responde 500 explícito. */
  loginGoogle: LoginGoogle | null;
};

/**
 * Compone los casos de uso de la capa de aplicación a partir de los puertos.
 * Los casos de uso son orquestación de negocio (capa application) — se construyen aquí, no
 * en infra, que solo instancia implementaciones externas. La sesión se ensambla en index.ts.
 */
export const buildUseCases = (
  { users, refreshTokens, hasher, tokens, magicLinks, otpCodes, sender, compromised, google, unitOfWork }: Ports,
  logger: Logger,
): UseCases => ({
  registerUser: new RegisterUser(users, hasher, compromised, tokens, unitOfWork, logger, refreshTokens),
  login: new Login(users, hasher, tokens, logger, refreshTokens),
  refreshTokens: new RefreshTokens(refreshTokens, tokens, logger),
  logout: new Logout(refreshTokens, tokens, logger),
  requestMagicLink: new RequestMagicLink(magicLinks, tokens, sender, logger),
  consumeMagicLink: new ConsumeMagicLink(users, magicLinks, tokens, unitOfWork, logger, refreshTokens),
  requestOtp: new RequestOtp(otpCodes, hasher, sender, logger),
  verifyOtp: new VerifyOtp(users, otpCodes, hasher, tokens, unitOfWork, logger, refreshTokens),
  me: new GetMe(users, logger),
  changePassword: new ChangePassword(users, hasher, compromised, logger, refreshTokens),
  resetPassword: new ResetPassword(users, magicLinks, hasher, compromised, tokens, unitOfWork, logger, refreshTokens),
  createGuestSession: new CreateGuestSession(users, tokens, unitOfWork, logger, refreshTokens),
  upgradeGuestAccount: new UpgradeGuestAccount(users, hasher, compromised, unitOfWork, logger),
  setUserRole: new SetUserRole(users, logger),
  loginGoogle: google === null ? null : new LoginGoogle(users, google, tokens, logger, refreshTokens),
});
