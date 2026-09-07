import type { Response } from 'express';
import type { SuccessBody } from './envelope.js';

/**
 * Único punto de emisión de respuestas de éxito del contrato (envelope.ts).
 * - `data` ≠ null → `{ data }` tipado (`satisfies` rompe en compilación si `SuccessBody` cambia).
 * - `data === null` → sin body (`res.end()`), para status como 204 No Content.
 *   `null` significa "sin body", NO un payload nulo (hoy ningún endpoint devuelve `{ data: null }`).
 * El status code sigue siendo decisión del handler (transporte), junto a su `execute`.
 */
export const writeSuccess = <T>(res: Response, status: number, data: T | null): void => {
  if (data === null) {
    res.status(status).end();
    return;
  }
  res.status(status).json({ data } satisfies SuccessBody<T>);
};