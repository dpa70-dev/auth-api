import { ErrorCodes, ERROR_MESSAGES, type ErrorCode, type ValidationIssue } from './errorCatalog.js';

/**
 * Error del dominio con código del catálogo (doc 03 → schema Error.code).
 * El dominio NO conoce códigos HTTP: el errorMiddleware lo traduce a status (paso 22).
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: ValidationIssue[] | undefined;

  constructor(
    code: ErrorCode,
    options?: { message?: string; details?: ValidationIssue[]; cause?: unknown },
  ) {
    super(options?.message ?? ERROR_MESSAGES[code], { cause: options?.cause });
    this.name = 'ApiError';
    this.code = code;
    this.details = options?.details;
  }

  static validation(details: ValidationIssue[]): ApiError {
    return new ApiError(ErrorCodes.VALIDATION_ERROR, { details });
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;