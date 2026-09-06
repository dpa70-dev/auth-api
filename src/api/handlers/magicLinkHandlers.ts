import type { RequestHandler } from 'express';
import type { UseCases } from '../../app/buildUseCases.js';
import { magicLinkConsumeRequest, magicLinkRequest } from './schemas.js';
import { sendData } from '../protocol/success.js';
import type { ApiDeps } from '../deps.js';

/** Handlers del flujo magic link (US-09 request, US-10 consume/auto-cuenta). */
export const buildMagicLinkHandlers = (useCases: UseCases, deps: ApiDeps) => {
  const magicLinkRequestHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = magicLinkRequest.parse(req.body);
      await useCases.requestMagicLink.execute({
        email: body.email,
        magicLinkTtlMinutes: deps.config.magicLink.ttlMinutes,
        consumeBaseUrl: deps.config.magicLink.consumeBaseUrl,
      });
      sendData(res, 200, { ok: true });
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
      sendData(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  return { magicLinkRequestHandler, magicLinkConsumeHandler };
};