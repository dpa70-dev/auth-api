import { Router } from 'express';
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
    handler: (_req, res) => {
      res.status(429).set('Retry-After', String(config.rateLimit.authWindowMs / 1000)).json({
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: ERROR_MESSAGES[ErrorCodes.RATE_LIMITED],
          requestId: res.req.requestId ?? 'req_unknown',
        },
      });
    },
  });

/** Rutas declarativas: la lógica de cada endpoint vive en handlers/, aquí solo se montan. */
export const apiRouter = (useCases: UseCases, deps: ApiDeps): Router => {
  const router = Router();
  const {
    authRegisterHandler,
    authLoginHandler,
    authRefreshHandler,
    authLogoutHandler,
    authGoogleHandler,
    magicLinkRequestHandler,
    magicLinkConsumeHandler,
    meHandler,
  } = buildHandlers(useCases, deps);

  router.post('/auth/register', authLimiter(deps.config), authRegisterHandler);
  router.post('/auth/login', authLimiter(deps.config), authLoginHandler);
  router.post('/auth/refresh', authLimiter(deps.config), authRefreshHandler);
  router.post('/auth/logout', authLimiter(deps.config), authLogoutHandler);
  router.post('/auth/google', authLimiter(deps.config), authGoogleHandler);
  router.post('/auth/magic-link/request', authLimiter(deps.config), magicLinkRequestHandler);
  router.post('/auth/magic-link/consume', authLimiter(deps.config), magicLinkConsumeHandler);
  router.get('/auth/me', requireAuth(deps.tokens), meHandler);

  // Express 5 NO produce error `method_not_allowed` por sí solo cuando la ruta
  // existe pero el método no: emite el error aquí para que el handler final dé 405.
  router.use((req, _res, next) => {
    const allowed = ALLOWED_METHODS[req.path];
    if (allowed && !allowed.includes(req.method)) {
      next(Object.assign(new Error('Method Not Allowed'), { type: ERROR_KIND_METHOD_NOT_ALLOWED }));
      return;
    }
    next();
  });

  return router;
};

const ALLOWED_METHODS: Record<string, string[]> = {
  '/auth/register': ['POST'],
  '/auth/login': ['POST'],
  '/auth/refresh': ['POST'],
  '/auth/logout': ['POST'],
  '/auth/google': ['POST'],
  '/auth/magic-link/request': ['POST'],
  '/auth/magic-link/consume': ['POST'],
  '/auth/me': ['GET'],
};