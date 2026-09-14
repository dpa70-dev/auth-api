import type { Database } from 'better-sqlite3';
import type { UnitOfWork } from '../domain/port/index.js';

/**
 * Unit of Work sobre la conexión SQLite (doc 13 → §13.1).
 *
 * better-sqlite3 es síncrono y single-connection: BEGIN/COMMIT/ROLLBACK sobre la conexión abarca a
 * TODOS los repos (drizzle opera sobre esa misma conexión). ver fase de diseño en
 * docs/13 §13.1 — por eso `fn` no recibe instancias "transaccionales": son las mismas.
 *
 * Guardia anti-anidamiento: SQLite no soporta BEGIN anidado; si un use case llamara
 * withTransaction dentro de otro, fallamos explícito en lugar de corromper la tx.
 */
export class SqliteUnitOfWork implements UnitOfWork {
  constructor(private readonly sqlite: Database) {}

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.sqlite.inTransaction) {
      throw new Error('SqliteUnitOfWork: transacción anidada no soportada');
    }
    this.sqlite.exec('BEGIN');
    try {
      const result = await fn();
      this.sqlite.exec('COMMIT');
      return result;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }
}