/**
 * Status codes del contrato derivados del OpenAPI generado (`src/api/contract.ts`).
 * Fuente única: `docs/03-openapi.yaml` → `npm run contract`.
 *
 * `SuccessStatus` y `ErrorStatus` se derivan de las claves `responses` de TODAS las
 * operaciones (`operations`), filtrando por rango (2xx vs 4xx/5xx) con template-literal
 * types. Si el contrato agrega/elimina un status, `tsc` lo propaga aquí automáticamente.
 *
 * `404` y `405` NO están declarados como `responses` por operación en el OpenAPI: son
 * respuestas CENTRALIZADAS del middleware (`notFound` y `methodNotAllowed` de Express 5,
 * doc 00 → ítem 24). Por eso se añaden a la unión manualmente, documentadas, en lugar de
 * obligar al YAML a repetirlas en los 11 paths.
 *
 * Regla (doc 05 → §15): el dominio no importa `contract.ts`; solo la capa `api` lo usa.
 */
import type { operations } from '../contract.js';

/** Unión de TODOS los status declarados en responses del contrato (por operación). */
type AllContractStatuses = {
  [Op in keyof operations]: keyof operations[Op]['responses'];
}[keyof operations];

/** Filtra la unión numérica: solo los 2xx (éxito). */
type Is2xx<S> = S extends number ? `${S}` extends `2${string}` ? S : never : never;
/** Filtra la unión numérica: solo los 4xx/5xx (error). */
type Is4xx5xx<S> = S extends number ? `${S}` extends `4${string}` | `5${string}` ? S : never : never;

/** Status de éxito: 2xx declarados en el contrato (hoy `200 | 201 | 204`). */
export type SuccessStatus = Is2xx<AllContractStatuses>;

/** Status de error: 4xx/5xx del contrato + 404/405 centralizados del middleware. */
export type ErrorStatus = Is4xx5xx<AllContractStatuses> | 404 | 405;