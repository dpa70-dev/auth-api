/** Violación de unicidad de la BD (email o google_sub). La infra la traduce; el dominio la entiende. */
export class UniqueConstraintViolation extends Error {
  constructor(cause?: unknown) {
    super('Unique constraint violation', { cause });
    this.name = 'UniqueConstraintViolation';
  }
}