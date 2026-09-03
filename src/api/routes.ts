import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ERROR_KIND_METHOD_NOT_ALLOWED } from './errorKinds.js';
import type { RegisterUser } from '../app/registerUser.js';
import type { Login } from '../app/login.js';
import type { RefreshTokens } from '../app/refreshTokens.js';
import type { Logout } from '../app/logout.js';
import type { LoginGoogle } from '../app/loginGoogle.js';
import { requireAuth } from './authMiddleware.js';
import { ApiError } from '../domain/apiError.js';
import { ERROR_MESSAGES, ErrorCodes } from '../domain/errorCatalog.js';
import type { TokenIssuer, UserRepository } from '../domain/port/index.js';
import type { Config } from '../config.js';

export type UseCases = {
  registerUser: RegisterUser;
  login: Login;
  refreshTokens: RefreshTokens;
  logout: Logout;
  /** null ⇔ GOOGLE_CLIENT_ID no configurado: la ruta existe pero responde 500 explícito. */
  loginGoogle: LoginGoogle | null;
};

export type ApiDeps = {
  tokens: TokenIssuer;
  users: UserRepository;
  config: Config;
};

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

export const apiRouter = (useCases: UseCases, deps: ApiDeps): Router => {
  const router = Router();

  router.post('/auth/register', authLimiter(deps.config), async (req, res, next) => {
    try {
      const body = credentialsRequest.parse(req.body);
      const result = await useCases.registerUser.execute({
        email: body.email,
        password: body.password,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/login', authLimiter(deps.config), async (req, res, next) => {
    try {
      const body = credentialsRequest.parse(req.body);
      const result = await useCases.login.execute({
        email: body.email,
        password: body.password,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/refresh', authLimiter(deps.config), async (req, res, next) => {
    try {
      const body = refreshRequest.parse(req.body);
      const result = await useCases.refreshTokens.execute({
        refreshToken: body.refreshToken,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', authLimiter(deps.config), async (req, res, next) => {
    try {
      const body = refreshRequest.parse(req.body);
      await useCases.logout.execute({ refreshToken: body.refreshToken });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/google', authLimiter(deps.config), async (req, res, next) => {
    try {
      const body = googleRequest.parse(req.body);
      if (useCases.loginGoogle === null) {
        throw new ApiError(ErrorCodes.INTERNAL_ERROR, { message: 'El inicio de sesión con Google no está configurado.' });
      }
      const result = await useCases.loginGoogle.execute({
        idToken: body.idToken,
        ...(body.nonce !== undefined ? { nonce: body.nonce } : {}),
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/me', requireAuth(deps.tokens), async (req, res, next) => {
    try {
      // requireAuth garantiza userId; el guard es defensa extra del contrato (nunca `!`).
      const userId = req.userId;
      if (!userId) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      const user = await deps.users.findById(userId);
      if (!user) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      res.status(200).json({
        data: { id: user.id, email: user.email, createdAt: user.createdAt },
      });
    } catch (err) {
      next(err);
    }
  });

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
  '/auth/me': ['GET'],
};

/** Schemas de la frontera (doc 03 → CredentialsRequest/RefreshRequest/GoogleRequest). */
const credentialsRequest = z.object({
  email: z
    .string({ message: 'email debe ser un string' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: 'invalid_email' }).max(254, { message: 'email_too_long' })),
  password: z
    .string({ message: 'password debe ser un string' })
    .min(8, { message: 'too_short' })
    .max(64, { message: 'too_long' }),
});

const refreshRequest = z.object({
  refreshToken: z.string({ message: 'refreshToken debe ser un string' }).min(1, { message: 'too_short' }),
});

const googleRequest = z.object({
  idToken: z.string({ message: 'idToken debe ser un string' }).min(1, { message: 'too_short' }),
  nonce: z.string({ message: 'nonce debe ser un string' }).min(1, { message: 'too_short' }).optional(),
});