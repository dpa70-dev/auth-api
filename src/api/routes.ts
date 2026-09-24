import { Router } from 'express';
import type { RequestHandler } from 'express';
import { ERROR_KIND_METHOD_NOT_ALLOWED } from './protocol/errorKinds.js';
import { requireAuth } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { authLimiter } from './middlewares/rateLimiters.js';
import type { UseCases } from '../app/buildUseCases.js';
import { buildHandlers } from './buildHandlers.js';
import type { ApiDeps } from './deps.js';
import { API_PATHS } from './paths.js';

/** Declaración de una ruta: ÚNICA fuente de verdad de método+path (registro y 405 derivan de aquí). */
type RouteDeclaration = {
  method: 'get' | 'post' | 'patch';
  path: string;
  /** Guardas en orden de ejecución, antes del handler (p. ej. [authLimiter, requireAuth]). */
  guards: RequestHandler[];
  handler: RequestHandler;
};

/** Rutas declarativas: la lógica de cada endpoint vive en handlers/, aquí solo se montan. */
export const apiRouter = (useCases: UseCases, deps: ApiDeps): Router => {
  const router = Router();
  const {
    authRegisterHandler,
    authLoginHandler,
    authRefreshHandler,
    authLogoutHandler,
    authChangePasswordHandler,
    authGoogleHandler,
    magicLinkRequestHandler,
    magicLinkConsumeHandler,
    passwordResetHandler,
    otpRequestHandler,
    otpVerifyHandler,
    guestHandler,
    guestUpgradeHandler,
    meHandler,
    setUserRoleHandler,
    setUserModerationStatusHandler,
  } = buildHandlers(useCases, deps);

  // Rutas declaradas en UN solo lugar: el registro y el 405 derivan de la misma tabla (OCP/DRY).
  const routeTable: RouteDeclaration[] = [
    { method: 'post', path: API_PATHS.register, guards: [authLimiter(deps.config)], handler: authRegisterHandler },
    { method: 'post', path: API_PATHS.login, guards: [authLimiter(deps.config)], handler: authLoginHandler },
    { method: 'post', path: API_PATHS.refresh, guards: [authLimiter(deps.config)], handler: authRefreshHandler },
    { method: 'post', path: API_PATHS.logout, guards: [authLimiter(deps.config)], handler: authLogoutHandler },
    // US-11: requiere sesión (la contraseña actual es el reto) y luego el throttle de /auth.
    { method: 'post', path: API_PATHS.changePassword, guards: [requireAuth(deps.tokens), authLimiter(deps.config)], handler: authChangePasswordHandler },
    { method: 'post', path: API_PATHS.google, guards: [authLimiter(deps.config)], handler: authGoogleHandler },
    { method: 'post', path: API_PATHS.magicLinkRequest, guards: [authLimiter(deps.config)], handler: magicLinkRequestHandler },
    { method: 'post', path: API_PATHS.magicLinkConsume, guards: [authLimiter(deps.config)], handler: magicLinkConsumeHandler },
    // US-12: el token del email ES la credencial → solo authLimiter (sin requireAuth).
    { method: 'post', path: API_PATHS.passwordReset, guards: [authLimiter(deps.config)], handler: passwordResetHandler },
    // US-13/14: el código OTP ES la credencial → solo authLimiter (sin requireAuth).
    { method: 'post', path: API_PATHS.otpRequest, guards: [authLimiter(deps.config)], handler: otpRequestHandler },
    { method: 'post', path: API_PATHS.otpVerify, guards: [authLimiter(deps.config)], handler: otpVerifyHandler },
    // US-15: sesión guest anónima → solo throttle /auth (crear sesión NO requiere identidad).
    { method: 'post', path: API_PATHS.guest, guards: [authLimiter(deps.config)], handler: guestHandler },
    // US-16: reclama identidad sobre la sesión guest → requireAuth (debe estar autenticado) + throttle.
    { method: 'post', path: API_PATHS.guestUpgrade, guards: [requireAuth(deps.tokens), authLimiter(deps.config)], handler: guestUpgradeHandler },
    { method: 'get', path: API_PATHS.me, guards: [requireAuth(deps.tokens)], handler: meHandler },
    // rol de autorización: requireAuth primero (401 anónimo), luego requireRole('admin') (1 SELECT).
    { method: 'patch', path: API_PATHS.adminUserRole, guards: [requireAuth(deps.tokens), requireRole('admin', deps.users)], handler: setUserRoleHandler },
    // estado de moderación: misma autorización admin que el rol; requireRole protege ambos ejes (doc 04).
    { method: 'patch', path: API_PATHS.adminUserStatus, guards: [requireAuth(deps.tokens), requireRole('admin', deps.users)], handler: setUserModerationStatusHandler },
  ];

  const allowedMethods: Record<string, string[]> = {};
  for (const route of routeTable) {
    router[route.method](route.path, ...route.guards, route.handler);
    (allowedMethods[route.path] ??= []).push(route.method.toUpperCase());
  }

  // Express 5 NO produce error `method_not_allowed` por sí solo cuando la ruta
  // existe pero el método no: emite el error aquí para que el handler final dé 405.
  // Normaliza el trailing slash: POST /auth/me/ es la MISMA ruta que POST /auth/me → 405.
  router.use((req, _res, next) => {
    const path = req.path.replace(/\/+$/, '');
    const allowed = allowedMethods[path];
    if (allowed && !allowed.includes(req.method)) {
      next(Object.assign(new Error('Method Not Allowed'), { type: ERROR_KIND_METHOD_NOT_ALLOWED }));
      return;
    }
    next();
  });

  return router;
};