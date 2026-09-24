import type { RequestHandler } from 'express';
import type { UseCases } from '../app/buildUseCases.js';
import { buildAuthHandlers } from './handlers/authHandlers.js';
import { buildMagicLinkHandlers } from './handlers/magicLinkHandlers.js';
import { buildOtpHandlers } from './handlers/otpHandlers.js';
import { buildMeHandler } from './handlers/meHandler.js';
import { buildGuestHandlers } from './handlers/guestHandlers.js';
import { buildAdminHandlers } from './handlers/adminHandlers.js';
import type { ApiDeps } from './deps.js';

/** Handlers de la frontera HTTP, enrutados por routes.ts (rutas declarativas sin lógica inline). */
export type Handlers = {
  authRegisterHandler: RequestHandler;
  authLoginHandler: RequestHandler;
  authRefreshHandler: RequestHandler;
  authLogoutHandler: RequestHandler;
  authChangePasswordHandler: RequestHandler;
  authGoogleHandler: RequestHandler;
  magicLinkRequestHandler: RequestHandler;
  magicLinkConsumeHandler: RequestHandler;
  passwordResetHandler: RequestHandler;
  otpRequestHandler: RequestHandler;
  otpVerifyHandler: RequestHandler;
  guestHandler: RequestHandler;
  guestUpgradeHandler: RequestHandler;
  meHandler: RequestHandler;
  setUserRoleHandler: RequestHandler;
};

/** Construye los handlers a partir de los casos de uso y las dependencias de la frontera. */
export const buildHandlers = (useCases: UseCases, deps: ApiDeps): Handlers => ({
  ...buildAuthHandlers(useCases, deps),
  ...buildMagicLinkHandlers(useCases, deps),
  ...buildOtpHandlers(useCases, deps),
  ...buildGuestHandlers(useCases, deps),
  ...buildMeHandler(useCases),
  ...buildAdminHandlers(useCases),
});