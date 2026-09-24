import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ErrorCode, ValidationIssue } from '../../domain/errorCatalog.js';
import { writeError, type ErrorStatus } from '../protocol/error.js';
import { ERROR_KIND_METHOD_NOT_ALLOWED } from '../protocol/errorKinds.js';
import { generateRequestId } from './middleware.js';
import { ApiError, isApiError } from '../../domain/apiError.js';
import { ERROR_MESSAGES, ErrorCodes } from '../../domain/errorCatalog.js';

/**
 * Traducción code→status HTTP del contrato (doc 03 → responses de cada endpoint).
 * El dominio nunca conoce HTTP: esta es la ÚNICA frontera que mapea códigos a status.
 * Record exhaustivo: agregar un código al catálogo sin status aquí falla en compilación.
 */
export const STATUS_BY_CODE: Record<ErrorCode, ErrorStatus> = {
  [ErrorCodes.VALIDATION_ERROR]: 422,
  [ErrorCodes.INVALID_CREDENTIALS]: 401,
  [ErrorCodes.EMAIL_ALREADY_EXISTS]: 409,
  [ErrorCodes.ACCOUNT_EXISTS_WITH_GOOGLE]: 409,
  [ErrorCodes.ACCOUNT_HAS_NO_PASSWORD]: 409,
  [ErrorCodes.GUEST_UPGRADE_INVALID]: 409,
  [ErrorCodes.EMAIL_NOT_VERIFIED]: 401,
  [ErrorCodes.PASSWORD_COMPROMISED]: 422,
  [ErrorCodes.MAGIC_LINK_INVALID]: 401,
  [ErrorCodes.OTP_INVALID]: 401,
  [ErrorCodes.RATE_LIMITED]: 429,
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.MALFORMED_REQUEST]: 400,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.METHOD_NOT_ALLOWED]: 405,
  [ErrorCodes.INTERNAL_ERROR]: 500,
};

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/** Convierte ZodError de la frontera en detalles del contrato (field → issue). */
const zodToIssues = (err: ZodError): ValidationIssue[] =>
  err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }));

/** 404 centralizado (doc 00 → ítem 24): cualquier GET/POST no declarado en el contrato. */
export const notFound = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(ErrorCodes.NOT_FOUND));
};

/**
 * Handler final de errores. Clasifica: método no permitido (Express 5), body malformado/oversize,
 * ApiError del dominio, ZodError de la frontera y 500 genérico SIN stack traces (doc 00 → ítem 20).
 */
export const finalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = req.requestId ?? generateRequestId();

  if (isMethodNotAllowed(err)) {
    writeError(res, STATUS_BY_CODE[ErrorCodes.METHOD_NOT_ALLOWED], { code: ErrorCodes.METHOD_NOT_ALLOWED, message: ERROR_MESSAGES[ErrorCodes.METHOD_NOT_ALLOWED], requestId });
    return;
  }
  // body-parser (express.json): JSON inválido o payload excedido → 400 MALFORMED_REQUEST del contrato.
  if (isMalformedBody(err)) {
    writeError(res, STATUS_BY_CODE[ErrorCodes.MALFORMED_REQUEST], {
      code: ErrorCodes.MALFORMED_REQUEST,
      message: ERROR_MESSAGES[ErrorCodes.MALFORMED_REQUEST],
      requestId,
    });
    return;
  }
  if (isApiError(err)) {
    writeError(res, STATUS_BY_CODE[err.code], {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }
  if (err instanceof ZodError) {
    writeError(res, STATUS_BY_CODE[ErrorCodes.VALIDATION_ERROR], {
      code: ErrorCodes.VALIDATION_ERROR,
      message: ERROR_MESSAGES[ErrorCodes.VALIDATION_ERROR],
      details: zodToIssues(err),
      requestId,
    });
    return;
  }
  writeError(res, STATUS_BY_CODE[ErrorCodes.INTERNAL_ERROR], {
    code: ErrorCodes.INTERNAL_ERROR,
    message: ERROR_MESSAGES[ErrorCodes.INTERNAL_ERROR],
    requestId,
  });
};

/** Error de Express 5 cuando la ruta existe pero el método no (se declara su router). */
const isMethodNotAllowed = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { type?: unknown }).type === ERROR_KIND_METHOD_NOT_ALLOWED;

/** Error de body-parser (express.json): entity.parse.failed / entity.too.large. */
const isMalformedBody = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const type = (err as { type?: unknown }).type;
  return type === 'entity.parse.failed' || type === 'entity.too.large';
};
