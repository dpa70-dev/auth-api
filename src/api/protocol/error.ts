import type { Response } from 'express';
import type { ErrorBody } from './envelope.js';

/**
 * Único punto de emisión de respuestas de error del contrato (envelope.ts).
 * Par de `writeSuccess`: ambos emiten el envelope (`{ error }` vs `{ data }`).
 * El status code es decisión del caller (transporte), nunca del dominio.
 */

/** Status de error del contrato: conjunto cerrado de 4xx/5xx emitidos por writeError — espejo de STATUS_BY_CODE. */
export type ErrorStatus = 400 | 401 | 404 | 405 | 409 | 422 | 429 | 500;

export const writeError = (res: Response, status: ErrorStatus, error: ErrorBody['error']): void => {
  res.status(status).json({ error });
};
