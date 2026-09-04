import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { UseCases } from '../../app/buildUseCases.js';

/** GET /auth/me (US-05): perfil autenticado; requireAuth ya validó el access en la ruta. */
export const buildMeHandler = (useCases: UseCases) => {
  const meHandler: RequestHandler = async (req, res, next) => {
    try {
      // requireAuth garantiza userId; el guard es defensa extra del contrato (nunca `!`).
      const userId = req.userId;
      if (!userId) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      const result = await useCases.me.execute({ userId });
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  };

  return { meHandler };
};