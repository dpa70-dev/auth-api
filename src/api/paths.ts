/**
 * Paths del contrato (doc 03 → openapi) RELATIVOS a API_PREFIX: el mount en index.ts agrega el
 * prefijo en el server, config.ts lo compone explícitamente en las URLs de email. Fuente única
 * para routes.ts y config.ts — un cambio de ruta no puede desincronizar los emails.
 */
export const API_PATHS = {
  register: '/auth/register',
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  changePassword: '/auth/change-password',
  google: '/auth/google',
  magicLinkRequest: '/auth/magic-link/request',
  magicLinkConsume: '/auth/magic-link/consume',
  passwordReset: '/auth/password/reset',
  otpRequest: '/auth/otp/request',
  otpVerify: '/auth/otp/verify',
  guest: '/auth/guest',
  guestUpgrade: '/auth/guest/upgrade',
  me: '/auth/me',
} as const;