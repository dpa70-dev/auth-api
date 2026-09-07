import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { TokenIssuer } from '../../domain/port/index.js';
import { userIdSchema, type UserId } from '../../domain/vo/index.js';

declare global {
  namespace Express {
    interface Request {
      userId?: UserId;
    }
  }
}

/**
 * US-05: valida el access token (firma HS256, exp, sub) y deja userId en request.
 * 401 idéntico para token ausente, malformado o vencido (contrato 03 → /auth/me).
 */
export const requireAuth = (tokens: TokenIssuer): RequestHandler => {
  return async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith(BEARER_PREFIX)) throw unauth();

      const payload = await tokens.verifyAccessToken(header.slice(BEARER_PREFIX.length));
      if (!payload) throw unauth();

      // Un sub no-UUID en un token firmado es un token malformado → 401, nunca 422 (US-05).
      const parsed = userIdSchema.safeParse(payload.sub);
      if (!parsed.success) throw unauth();
      req.userId = parsed.data;
      next();
    } catch (err) {
      next(err);
    }
  };
};

/** Prefijo del header Authorization (doc 03): fuente única de 'Bearer ' para startsWith y slice. */
const BEARER_PREFIX = 'Bearer ';

const unauth = () => new ApiError(ErrorCodes.UNAUTHORIZED);
