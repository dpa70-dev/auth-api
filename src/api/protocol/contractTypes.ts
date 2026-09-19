/**
 * Tipos de data del envelope `{ data }` derivados del contrato OpenAPI generado.
 * Fuente: `src/api/contract.ts` → `docs/03-openapi.yaml`.
 *
 * Cada alias tipa el payload JSON que un handler DEBE devolver en la respuesta 2xx
 * de su operación correspondiente. Si el use case cambia su `XxxResult` sin actualizar el
 * YAML, el handler falla `satisfies` / asignación en `writeSuccess` y `tsc` lo detecta.
 *
 * Regla (doc 05 → §15): el dominio no importa `contract.ts`; solo la capa `api` lo usa.
 */
import type { components } from '../contract.js';

/** Auth response — registerUser (201), login (200), loginGoogle (200), consumeMagicLink (200). */
export type AuthResponseData = components['schemas']['AuthResponse']['data'];

/** Refresh response — refreshTokens (200). */
export type RefreshResponseData = components['schemas']['RefreshResponse']['data'];

/** User profile — getMe (200). */
export type UserProfileData = components['schemas']['UserResponse']['data'];

/** Magic link request acknowledgement — requestMagicLink (200). */
export type MagicLinkRequestData = components['schemas']['MagicLinkRequestResponse']['data'];

/** OTP request acknowledgement — requestOtp (200). */
export type OtpRequestData = components['schemas']['OtpRequestResponse']['data'];
