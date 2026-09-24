import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { UserRepository } from '../../domain/port/index.js';
import type { UserRole } from '../../domain/vo/index.js';

/**
 * Autorización por rol (doc 04 → users.role): compone a requireAuth (que ya dejó req.userId)
 * y hace UN SELECT a users para leer el rol — no se embebe en el JWT (decisión planificada:
 * el cambio de rol es efectivo en el siguiente request sin esperar el exp del access token).
 * 403 FORBIDDEN genérico (idéntico para cualquier no-admin): anti-enumeración.
 */
export const requireRole =
  (role: UserRole, users: UserRepository): RequestHandler =>
  async (req, _res, next) => {
    try {
      // requireAuth garantiza userId; el guard es defensa extra del contrato (nunca `!`).
      const userId = req.userId;
      if (!userId) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      const user = await users.findById(userId);
      if (!user) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      if (user.role !== role) throw new ApiError(ErrorCodes.FORBIDDEN);
      next();
    } catch (err) {
      next(err);
    }
  };