import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { ApiDeps } from '../deps.js';

/** GET /auth/me (US-05): perfil autenticado; requireAuth ya validó el access en la ruta. */
export const buildMeHandler = (deps: ApiDeps) => {
  const meHandler: RequestHandler = async (req, res, next) => {
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
  };

  return { meHandler };
};