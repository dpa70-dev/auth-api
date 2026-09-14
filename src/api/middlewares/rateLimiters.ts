import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { STATUS_BY_CODE } from './errorMiddleware.js';
import { ERROR_MESSAGES, ErrorCodes } from '../../domain/errorCatalog.js';
import type { Config } from '../../config.js';

/**
 * Fábrica común de los limitadores (doc 00 → ítems 41, 48-49): comparte el envelope
 * RATE_LIMITED del contrato (código, mensaje del catálogo y requestId ya propagado),
 * el header Retry-After y los headers estándar draft-7 de express-rate-limit.
 * Solo varía la ventana y el máximo entre el throttle global y el de /auth.
 */
const buildRateLimiter = (windowMs: number, limit: number): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res
        .status(STATUS_BY_CODE[ErrorCodes.RATE_LIMITED])
        .set('Retry-After', String(windowMs / 1000))
        .json({
          error: {
            code: ErrorCodes.RATE_LIMITED,
            message: ERROR_MESSAGES[ErrorCodes.RATE_LIMITED],
            requestId: req.requestId ?? 'req_unknown',
          },
        });
    },
  });

/** Throttle estricto de los endpoints /auth (doc 00 → ítems 41, 48-49). */
export const authLimiter = (config: Config): RequestHandler =>
  buildRateLimiter(config.rateLimit.authWindowMs, config.rateLimit.authMax);

/** Throttle global moderado de toda la API bajo API_PREFIX (doc 00 → ítem 49). */
export const globalLimiter = (config: Config): RequestHandler =>
  buildRateLimiter(config.rateLimit.windowMs, config.rateLimit.max);