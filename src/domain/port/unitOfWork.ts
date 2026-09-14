/**
 * Contrato de unidad de trabajo (doc 13 → §13.1): expone la transacción a la capa application
 * SIN filtrar SQL. `fn` contiene el bloque de escrituras y el puerto se encarga de
 * BEGIN/COMMIT/ROLLBACK.
 *
 * Regla de uso (doc 13.1 → tradeoff): `fn` ejecuta SOLO escrituras de repositorio — nunca llamadas
 * lentas o de red (argon2, HIBP, firmado jose). Esas deben completarse ANTES de abrir la tx;
 * si entraran, un `await` real cedería el event loop y otro request podría operar sobre la misma
 * conexión dentro de nuestra transacción.
 *
 * Decisión de implementación (better-sqlite3, driver síncrono de UNA conexión): la transacción es
 * alcance de CONEXIÓN, no de instancias de repositorio. Los repos inyectados en los use cases ya
 * operan sobre esa única conexión, así que BEGIN/COMMIT/ROLLBACK los abarca a todos. El doc 13.1
 * contemplaba entregar "repos transaccionales" a fn — con este driver sería un no-op (las mismas
 * instancias, la misma conexión), así que el puerto queda mínimamente honesto: fn no recibe nada.
 */
export interface UnitOfWork {
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
}