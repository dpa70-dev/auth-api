import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { UseCases } from '../../app/buildUseCases.js';
import { writeSuccess } from '../protocol/success.js';
import { setRefreshCookie } from '../cookies.js';
import type { ApiDeps } from '../deps.js';
import { upgradeGuestRequest } from './schemas.js';
import type { AuthResponseData, UserProfileData } from '../protocol/contractTypes.js';

/** Handlers de usuario invitado (US-15 creación de sesión, US-16 upgrade de cuenta). */
export const buildGuestHandlers = (useCases: UseCases, deps: ApiDeps) => {
  const guestHandler: RequestHandler = async (_req, res, next) => {
    try {
      const result = await useCases.createGuestSession.execute({
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess<AuthResponseData>(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  const guestUpgradeHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = upgradeGuestRequest.parse(req.body);
      // requireAuth garantiza userId; el guard es defensa extra del contrato (nunca `!`).
      const userId = req.userId;
      if (!userId) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      const result = await useCases.upgradeGuestAccount.execute({
        userId,
        email: body.email,
        password: body.password,
      });
      writeSuccess<UserProfileData>(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  return { guestHandler, guestUpgradeHandler };
};