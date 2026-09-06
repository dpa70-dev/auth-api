import { Router } from 'express';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ERROR_KIND_METHOD_NOT_ALLOWED } from './protocol/errorKinds.js';
import { requireAuth } from './middlewares/authMiddleware.js';
import { ERROR_MESSAGES, ErrorCodes } from '../domain/errorCatalog.js';
import type { UseCases } from '../app/buildUseCases.js';
import { buildHandlers } from './buildHandlers.js';
import type { ApiDeps } from './deps.js';
import type { Config } from '../config.js';

/** Los endpoints /auth comparten el rate limit estricto (doc 00 → ítems 41, 48-49). */
const authLimiter = (config: Config) =>
  rateLimit({
    windowMs: config.rateLimit.authWindowMs,
    limit: config.rateLimit.authMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).set('Retry-After', String(config.rateLimit.authWindowMs / 1000)).json({
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: ERROR_MESSAGES[ErrorCodes.RATE_LIMITED],
          requestId: req.requestId ?? 'req_unknown',
        },
      });
    },
  });

/** Declaración de una ruta: ÚNICA fuente de verdad de método+path (registro y 405 derivan de aquí). */
type RouteDeclaration = {
  method: 'get' | 'post';
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
    meHandler,
  } = buildHandlers(useCases, deps);

  // Rutas declaradas en UN solo lugar: el registro y el 405 derivan de la misma tabla (OCP/DRY).
  const routeTable: RouteDeclaration[] = [
    { method: 'post', path: '/auth/register', guards: [authLimiter(deps.config)], handler: authRegisterHandler },
    { method: 'post', path: '/auth/login', guards: [authLimiter(deps.config)], handler: authLoginHandler },
    { method: 'post', path: '/auth/refresh', guards: [authLimiter(deps.config)], handler: authRefreshHandler },
    { method: 'post', path: '/auth/logout', guards: [authLimiter(deps.config)], handler: authLogoutHandler },
    // US-11: requiere sesión (la contraseña actual es el reto) y luego el throttle de /auth.
    { method: 'post', path: '/auth/change-password', guards: [requireAuth(deps.tokens), authLimiter(deps.config)], handler: authChangePasswordHandler },
    { method: 'post', path: '/auth/google', guards: [authLimiter(deps.config)], handler: authGoogleHandler },
    { method: 'post', path: '/auth/magic-link/request', guards: [authLimiter(deps.config)], handler: magicLinkRequestHandler },
    { method: 'post', path: '/auth/magic-link/consume', guards: [authLimiter(deps.config)], handler: magicLinkConsumeHandler },
    // US-12: el token del email ES la credencial → solo authLimiter (sin requireAuth).
    { method: 'post', path: '/auth/password/reset', guards: [authLimiter(deps.config)], handler: passwordResetHandler },
    { method: 'get', path: '/auth/me', guards: [requireAuth(deps.tokens)], handler: meHandler },
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