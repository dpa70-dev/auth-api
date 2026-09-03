/**
 * Entidades del dominio (doc 02 → diagrama 6, doc 04 → modelo de datos).
 *
 * Barrel puro: un archivo por entidad. Las entidades solo se construyen desde VOs ya
 * validados o desde resultados de repositorio pre-validados; el dominio no conoce Express ni SQLite.
 */
export * from './user.js';