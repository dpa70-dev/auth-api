/**
 * Unidades de tiempo en ms (fuente única): los TTLs se configuran en minutos/días (config.ts)
 * y se aplican en ms (Date.now/getTime). Expresar la unidad en el nombre evita el número mágico
 * y fija la dirección de conversión.
 */
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const minutesToMs = (minutes: number): number => minutes * MINUTE_MS;
export const daysToMs = (days: number): number => days * DAY_MS;

/** Expiración ISO = now + ttlMs — fuente única del cálculo de expiraciones (magic link y refresh). */
export const expiresAtIso = (now: Date, ttlMs: number): string =>
  new Date(now.getTime() + ttlMs).toISOString();