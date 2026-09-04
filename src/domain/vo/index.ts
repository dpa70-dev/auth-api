/**
 * Value Objects del dominio (doc 02 → diagrama 6, sección 6.1).
 *
 * Principio: *parse, don't validate* — el input sucio se parsea UNA sola vez en la frontera
 * (presentación) y circula por el dominio como tipo ya válido. Cada VO es un schema Zod
 * brandeado: el tipo nominal impide que se confundan entre sí en tiempo de compilación.
 *
 * Barrel puro: un archivo por VO (schema + tipo juntos en la misma unidad).
 */
export * from './email.js';
export * from './googleSub.js';
export * from './jti.js';
export * from './magicLinkStatus.js';
export * from './passwordHash.js';
export * from './plainPassword.js';
export * from './provider.js';
export * from './refreshTokenStatus.js';
export * from './timestamp.js';
export * from './userId.js';