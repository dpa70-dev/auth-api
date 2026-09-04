import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { UseCases } from '../../app/buildUseCases.js';
import { credentialsRequest, googleRequest, refreshRequest } from './schemas.js';
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
      res.status(201).json({ data: result });
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
      res.status(200).json({ data: result });
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
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  };

  const authLogoutHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = refreshRequest.parse(req.body);
      await useCases.logout.execute({ refreshToken: body.refreshToken });
      res.status(204).end();
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
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  };

  return { authRegisterHandler, authLoginHandler, authRefreshHandler, authLogoutHandler, authGoogleHandler };
};