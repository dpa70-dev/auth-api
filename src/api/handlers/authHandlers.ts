import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { UseCases } from '../../app/buildUseCases.js';
import { changePasswordRequest, credentialsRequest, googleRequest, refreshRequest } from './schemas.js';
import { writeSuccess } from '../protocol/success.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../cookies.js';
import type { ApiDeps } from '../deps.js';
import type { AuthResponseData, RefreshResponseData } from '../protocol/contractTypes.js';

/** Handlers de credenciales (local) y Google. Cada uno es un cierre sobre (useCases, deps). */
export const buildAuthHandlers = (useCases: UseCases, deps: ApiDeps) => {
  const authRegisterHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = credentialsRequest.parse(req.body);
      const result = await useCases.registerUser.execute({
        email: body.email,
        password: body.password,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess<AuthResponseData>(res, 201, result);
    } catch (err) {
      next(err);
    }
  };

  const authLoginHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = credentialsRequest.parse(req.body);
      const result = await useCases.login.execute({
        email: body.email,
        password: body.password,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess<AuthResponseData>(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  const authRefreshHandler: RequestHandler = async (req, res, next) => {
    try {
      // docs/06 §3.3: la cookie es la fuente primaria del refresh (web); el body (móvil) sigue.
      const parsed = refreshRequest.safeParse(req.body ?? {});
      const presented = readRefreshCookie(req) ?? (parsed.success ? parsed.data.refreshToken : undefined);
      if (presented === undefined) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      const result = await useCases.refreshTokens.execute({
        refreshToken: presented,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess<RefreshResponseData>(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  const authLogoutHandler: RequestHandler = async (req, res, next) => {
    try {
      const parsed = refreshRequest.safeParse(req.body ?? {});
      const presented = readRefreshCookie(req) ?? (parsed.success ? parsed.data.refreshToken : undefined);
      if (presented === undefined) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      await useCases.logout.execute({ refreshToken: presented });
      clearRefreshCookie(res, deps.config);
      writeSuccess(res, 204, null);
    } catch (err) {
      next(err);
    }
  };

  const authChangePasswordHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = changePasswordRequest.parse(req.body);
      // requireAuth garantiza userId; el guard es defensa extra del contrato (nunca `!`).
      const userId = req.userId;
      if (!userId) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      await useCases.changePassword.execute({
        userId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      });
      writeSuccess(res, 204, null);
    } catch (err) {
      next(err);
    }
  };

  const authGoogleHandler: RequestHandler = async (req, res, next) => {
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
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess<AuthResponseData>(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  return { authRegisterHandler, authLoginHandler, authRefreshHandler, authLogoutHandler, authChangePasswordHandler, authGoogleHandler };
};