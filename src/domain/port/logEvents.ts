/**
 * Vocabulario del puerto Logger (doc 00 → ítems 10-15): nombre del evento como primer
 * argumento. Vive junto al puerto que lo consume (domain/port) — es su payload, no un
 * shared kernel de la raíz. Centralizar evita typos que romperían el monitoreo en silencio.
 */
export const LOG_EVENTS = {
  API_LISTENING: 'api_listening',
  SHUTDOWN_STARTED: 'shutdown_started',
  USER_REGISTERED: 'user_registered',
  USER_LOGGED_IN: 'user_logged_in',
  USER_LOGGED_OUT: 'user_logged_out',
  USER_PROFILE_FETCHED: 'user_profile_fetched',
  TOKENS_REFRESHED: 'tokens_refreshed',
  REFRESH_REUSE_DETECTED: 'refresh_reuse_detected',
  LOGIN_FAILED: 'login_failed',
  MAGIC_LINK_REQUESTED: 'magic_link_requested',
  MAGIC_LINK_CONSUMED: 'magic_link_consumed',
  MAGIC_LINK_INVALID_ATTEMPT: 'magic_link_invalid_attempt',
  USER_REGISTERED_VIA_MAGIC_LINK: 'user_registered_via_magic_link',
  OTP_REQUESTED: 'otp_requested',
  OTP_VERIFIED: 'otp_verified',
  OTP_INVALID_ATTEMPT: 'otp_invalid_attempt',
  USER_REGISTERED_VIA_OTP: 'user_registered_via_otp',
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_CHANGE_FAILED: 'password_change_failed',
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  PASSWORD_RESET_CONSUMED: 'password_reset_consumed',
  PASSWORD_RESET_INVALID_ATTEMPT: 'password_reset_invalid_attempt',
  PASSWORD_RESET_REGISTERED: 'password_reset_registered',
  PASSWORD_COMPROMISED_REJECTED: 'password_compromised_rejected',
  PASSWORD_BREACH_CHECK_FAILED: 'password_breach_check_failed',
  PASSWORD_BREACH_CHECK_FALLBACK: 'password_breach_check_fallback',
} as const;

/** Unión de eventos válidos: el puerto solo admite estos — compilar = no hay typos. */
export type LogEventName = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];

/** Motivos del evento LOGIN_FAILED (anti-enumeración doc 00 → ítem 41). */
export const LOG_REASONS = {
  BAD_PASSWORD: 'bad_password',
  UNKNOWN_EMAIL: 'unknown_email',
  GOOGLE_ONLY_USER: 'google_only_user',
  PASSWORD_MISMATCH: 'password_mismatch',
} as const;