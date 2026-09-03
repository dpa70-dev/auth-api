/**
 * Marcadores de error de Express 5 que viajan en `err.type` (doc 00 → ítem 24).
 * routes.ts lo emite y errorMiddleware lo detecta: un solo lugar evita drift del literal.
 */
export const ERROR_KIND_METHOD_NOT_ALLOWED = 'method_not_allowed' as const;