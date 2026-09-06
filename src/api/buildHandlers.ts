import type { RequestHandler } from 'express';
import type { UseCases } from '../app/buildUseCases.js';
import { buildAuthHandlers } from './handlers/authHandlers.js';
import { buildMagicLinkHandlers } from './handlers/magicLinkHandlers.js';
import { buildMeHandler } from './handlers/meHandler.js';
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
  meHandler: RequestHandler;
};

/** Construye los handlers a partir de los casos de uso y las dependencias de la frontera. */
export const buildHandlers = (useCases: UseCases, deps: ApiDeps): Handlers => ({
  ...buildAuthHandlers(useCases, deps),
  ...buildMagicLinkHandlers(useCases, deps),
  ...buildMeHandler(useCases),
});