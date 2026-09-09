import type { Response } from 'express';
import type { ErrorBody } from './envelope.js';

/**
 * Único punto de emisión de respuestas de error del contrato (envelope.ts).
 * Par de `writeSuccess`: ambos emiten el envelope (`{ error }` vs `{ data }`).
 * El status code es decisión del caller (transporte), nunca del dominio.
 */
export const writeError = (res: Response, status: number, error: ErrorBody['error']): void => {
  res.status(status).json({ error });
};
