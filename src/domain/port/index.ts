/**
 * Puertos del dominio (doc 02 → diagrama 6): contratos que la infraestructura implementa.
 * El dominio solo depende de estos tipos — nunca de Express, SQLite, jose ni pino (doc 00 → ítem 26).
 *
 * Barrel puro: un archivo por puerto (interface + tipos de payload del puerto).
 * El vocabulario de eventos del puerto Logger vive en su propio archivo (logEvents.js).
 */
export * from './googleIdTokenVerifier.js';
export * from './logEvents.js';
export * from './logger.js';
export * from './passwordHasher.js';
export * from './tokenIssuer.js';
export * from './userRepository.js';