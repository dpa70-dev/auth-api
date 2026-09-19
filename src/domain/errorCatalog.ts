/**
 * Catálogo de errores del contrato (doc 00 → ítems 16-21, 24). FUENTE ÚNICA:
 * ErrorCode, ErrorCodes y ERROR_MESSAGES se DERIVAN de este arreglo — agregar un
 * error nuevo toca SOLO este arreglo. ApiError y la API derivan de aquí; nunca
 * escribir un literal suelto en un call-site.
 */
export const ERROR_CATALOG = [
  { code: 'VALIDATION_ERROR', message: 'La petición no cumple las reglas de validación.' },
  { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas.' },
  { code: 'EMAIL_ALREADY_EXISTS', message: 'Ya existe una cuenta con este email.' },
  { code: 'ACCOUNT_EXISTS_WITH_GOOGLE', message: 'Ya existe una cuenta con este email usando Google. Entrá con Google.' },
  { code: 'ACCOUNT_HAS_NO_PASSWORD', message: 'La cuenta no tiene una contraseña configurada.' },
  { code: 'GUEST_UPGRADE_INVALID', message: 'La cuenta no es de tipo invitado.' },
  { code: 'EMAIL_NOT_VERIFIED', message: 'El email no está verificado en Google.' },
  { code: 'PASSWORD_COMPROMISED', message: 'La contraseña fue comprometida en una filtración conocida; elegí otra.' },
  { code: 'MAGIC_LINK_INVALID', message: 'Enlace de acceso inválido o expirado.' },
  { code: 'OTP_INVALID', message: 'Código de acceso inválido o expirado.' },
  { code: 'RATE_LIMITED', message: 'Demasiados intentos. Reintentá más tarde.' },
  { code: 'UNAUTHORIZED', message: 'No autenticado.' },
  { code: 'MALFORMED_REQUEST', message: 'El cuerpo de la petición es inválido o excede el tamaño permitido.' },
  { code: 'NOT_FOUND', message: 'Recurso no encontrado.' },
  { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' },
  { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' },
] as const;

export type ErrorCode = (typeof ERROR_CATALOG)[number]['code'];

/** Mapa literales code→code (tj. VALIDATION_ERROR: 'VALIDATION_ERROR') derivado en compilación del catálogo. */
type ErrorCodesByCode = { [K in ErrorCode]: K };

/** Acceso por puntos (ErrorCodes.X) para los call-sites — derivado, no una segunda fuente. */
export const ErrorCodes: ErrorCodesByCode = Object.fromEntries(
  ERROR_CATALOG.map(({ code }) => [code, code]),
) as ErrorCodesByCode;

export const ERROR_MESSAGES: Record<ErrorCode, string> = Object.fromEntries(
  ERROR_CATALOG.map(({ code, message }) => [code, message]),
) as Record<ErrorCode, string>;

/** Forma de una validación fallida: campo del payload + problema detectado (espejo del schema ValidationIssue en doc 03). */
export type ValidationIssue = { field: string; issue: string };