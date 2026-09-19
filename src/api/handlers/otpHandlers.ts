import type { RequestHandler } from 'express';
import type { UseCases } from '../../app/buildUseCases.js';
import { otpRequest, otpVerifyRequest } from './schemas.js';
import { writeSuccess } from '../protocol/success.js';
import { setRefreshCookie } from '../cookies.js';
import type { ApiDeps } from '../deps.js';
import type { AuthResponseData, OtpRequestData } from '../protocol/contractTypes.js';

/** Handlers del flujo OTP (US-13 request, US-14 verify/auto-cuenta) — espejo de magicLinkHandlers. */
export const buildOtpHandlers = (useCases: UseCases, deps: ApiDeps) => {
  const otpRequestHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = otpRequest.parse(req.body);
      await useCases.requestOtp.execute({
        email: body.email,
        otpTtlMinutes: deps.config.otp.ttlMinutes,
      });
      writeSuccess<OtpRequestData>(res, 200, { ok: true });
    } catch (err) {
      next(err);
    }
  };

  const otpVerifyHandler: RequestHandler = async (req, res, next) => {
    try {
      const body = otpVerifyRequest.parse(req.body);
      const result = await useCases.verifyOtp.execute({
        email: body.email,
        code: body.code,
        refreshTtlDays: deps.config.refreshTtlDays,
      });
      setRefreshCookie(res, result.refreshToken, deps.config);
      writeSuccess<AuthResponseData>(res, 200, result);
    } catch (err) {
      next(err);
    }
  };

  return { otpRequestHandler, otpVerifyHandler };
};