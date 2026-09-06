/**
 * Catálogo de códigos de error del contrato (doc 00 → ítems 16-21, 24). FUENTE ÚNICA:
 * ApiError y la API derivan de aquí; nunca escribir un literal suelto en un call-site.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  ACCOUNT_EXISTS_WITH_GOOGLE: 'ACCOUNT_EXISTS_WITH_GOOGLE',
  ACCOUNT_HAS_NO_PASSWORD: 'ACCOUNT_HAS_NO_PASSWORD',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  MAGIC_LINK_INVALID: 'MAGIC_LINK_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  MALFORMED_REQUEST: 'MALFORMED_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Forma de una validación fallida: campo del payload + problema detectado (espejo del schema ValidationIssue en doc 03). */
export type ValidationIssue = { field: string; issue: string };

/**
 * Mensajes estables del contrato. Record exhaustivo: agregar un código al catálogo
 * sin mensaje aquí falla en compilación. Los 401 son idénticos (anti-enumeración, ítem 41).
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'La petición no cumple las reglas de validación.',
  INVALID_CREDENTIALS: 'Credenciales inválidas.',
  EMAIL_ALREADY_EXISTS: 'Ya existe una cuenta con este email.',
  ACCOUNT_EXISTS_WITH_GOOGLE: 'Ya existe una cuenta con este email usando Google. Entrá con Google.',
  ACCOUNT_HAS_NO_PASSWORD: 'La cuenta no tiene una contraseña configurada.',
  EMAIL_NOT_VERIFIED: 'El email no está verificado en Google.',
  MAGIC_LINK_INVALID: 'Enlace de acceso inválido o expirado.',
  RATE_LIMITED: 'Demasiados intentos. Reintentá más tarde.',
  UNAUTHORIZED: 'No autenticado.',
  MALFORMED_REQUEST: 'El cuerpo de la petición es inválido o excede el tamaño permitido.',
  NOT_FOUND: 'Recurso no encontrado.',
  METHOD_NOT_ALLOWED: 'Método no permitido.',
  INTERNAL_ERROR: 'Error interno del servidor.',
};