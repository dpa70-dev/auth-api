import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { UseCases } from '../../app/buildUseCases.js';
import { changePasswordRequest, credentialsRequest, googleRequest, refreshRequest } from './schemas.js';
import { sendData } from '../protocol/success.js';
import type { ApiDeps } from '../deps.js';

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
      sendData(res, 201, result);
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
      sendData(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  const authRefreshHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = refreshRequest.parse(req.body);
      const result = await useCases.refreshTokens.execute({
        refreshToken: body.refreshToken,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      sendData(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  const authLogoutHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = refreshRequest.parse(req.body);
      await useCases.logout.execute({ refreshToken: body.refreshToken });
      sendData(res, 204, null);
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
      sendData(res, 204, null);
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
      sendData(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  return { authRegisterHandler, authLoginHandler, authRefreshHandler, authLogoutHandler, authChangePasswordHandler, authGoogleHandler };
};