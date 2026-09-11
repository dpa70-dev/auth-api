import type { RequestHandler } from 'express';
import type { UseCases } from '../../app/buildUseCases.js';
import { magicLinkPurposeSchema } from '../../domain/vo/index.js';
import { magicLinkConsumeRequest, magicLinkRequest, passwordResetRequest } from './schemas.js';
import { writeSuccess } from '../protocol/success.js';
import { setRefreshCookie } from '../cookies.js';
import type { ApiDeps } from '../deps.js';

/** Handlers del flujo magic link (US-09 request, US-10 consume/auto-cuenta) y reset de contraseña (US-12). */
export const buildMagicLinkHandlers = (useCases: UseCases, deps: ApiDeps) => {
  const magicLinkRequestHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = magicLinkRequest.parse(req.body);
      // intent omiso = 'login'; la base de consumo la resuelve el intent (login vs reset, US-12).
      const intent = body.intent ?? magicLinkPurposeSchema.enum.login;
      await useCases.requestMagicLink.execute({
        email: body.email,
        intent,
        magicLinkTtlMinutes: deps.config.magicLink.ttlMinutes,
        consumeBaseUrl:
          intent === magicLinkPurposeSchema.enum.password_reset
            ? deps.config.magicLink.passwordResetConsumeBaseUrl
            : deps.config.magicLink.consumeBaseUrl,
      });
      writeSuccess(res, 200, { ok: true });
    } catch (err) {
      next(err);
    }
  };

  const magicLinkConsumeHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = magicLinkConsumeRequest.parse(req.body);
      const result = await useCases.consumeMagicLink.execute({
        token: body.token,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/password/reset: el token ES la credencial (solo authLimiter en la ruta, sin requireAuth).
  const passwordResetHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = passwordResetRequest.parse(req.body);
      await useCases.resetPassword.execute({ token: body.token, newPassword: body.password });
      writeSuccess(res, 204, null);
    } catch (err) {
      next(err);
    }
  };

  return { magicLinkRequestHandler, magicLinkConsumeHandler, passwordResetHandler };
};