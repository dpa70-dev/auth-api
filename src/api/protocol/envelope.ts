/**
 * Envelope único de la API (contrato 03, reglas transversales): éxito `{ data }`, error `{ error }`.
 * ErrorBody referencia tipos del dominio (errorCatalog.ts) pero no los re-exporta.
 */
import type { ErrorCode, ValidationIssue } from '../../domain/errorCatalog.js';

/** Envelope de error: siempre `{ error: { code, message, details?, requestId } }`. */
export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: ValidationIssue[];
    requestId: string;
  };
};

/** Envelope de éxito: siempre `{ data: ... }`. */
export type SuccessBody<T> = { data: T };