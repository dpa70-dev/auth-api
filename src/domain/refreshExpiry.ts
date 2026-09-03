import type { Timestamp } from './vo/index.js';

/** TTL del refresh token (doc 00 → ítem 39): configurable en días, aplicado desde la emisión. */
export const refreshExpiresAt = (now: Date, refreshTtlDays: number): Timestamp =>
  new Date(now.getTime() + refreshTtlDays * 24 * 60 * 60 * 1000).toISOString();

/** ¿El refresh venció? (US-03 AC-04) — contraparte de refreshExpiresAt: el dominio verifica su propia política. */
export const isRefreshExpired = (expiresAt: Timestamp, now: Date): boolean =>
  expiresAt <= now.toISOString();