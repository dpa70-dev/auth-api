import { z } from 'zod';
import 'dotenv/config';
import { API_PATHS } from './api/paths.js';

/** Prefijo de montaje de la API (doc 00 → nº 56): fuente única para el mount en index.ts y los links de email. */
export const API_PREFIX = '/api/v1';

/** Entornos de ejecución (NODE_ENV): fuente única del enum zod y del tipo NodeEnv derivado. */
export const nodeEnvValues = ['development', 'test', 'production'] as const;

export const nodeEnvSchema = z.enum(nodeEnvValues);

// Esquema de las variables de entorno: valida, aplica defaults y transforma al shape limpio.
const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  // Interfaz de bind del server HTTP (doc 00 → ítem 14). '0.0.0.0' expone en todas las interfaces.
  HOST: z.string().min(1).default('localhost'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres (HS256)'),

  // Vigencia (doc 00 → ítem 38): access 5-15 min · refresh 7-30 días
  ACCESS_TTL_MINUTES: z.coerce.number().int().min(5).max(15).default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(7).max(30).default(30),

  // Google OIDC (doc 00 → ítems 43-47)
  GOOGLE_CLIENT_ID: z.string().optional(),
  // Allowlist de emisores del ID token, separada por comas (patrón CORS_ORIGINS). Doc 00 → ítem 44.
  GOOGLE_ISSUER: z
    .string()
    .default('https://accounts.google.com')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  GOOGLE_JWKS_URL: z
    .url()
    .default('https://accounts.google.com/.well-known/jwks.json'),

  // SQLite (doc 00 → ítems 30-32)
  DB_PATH: z.string().default('data/app.sqlite'),

  // CORS allowlist (doc 00 → ítem 49)
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  // Rate limiting (doc 00 → ítems 41, 48-49) — ms y máx de intentos
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),

  // Magic link (doc 05 → magic link): TTL en minutos y origin público de la API (doc 00 → nº 56).
  // Los emails componen sus URLs con origin + API_PREFIX + path — el env solo declara el origin
  // (lo que varía por entorno); jamás se deriva del Host header del request (anti-poisoning).
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(15),
  // Origin público (esquema+host, sin path) de la API para los enlaces de email. Opcional:
  // vacío o ausente → default dev HOST:PORT (config de confianza en boot, no el Host header).
  PUBLIC_API_ORIGIN: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() !== '' ? s.trim() : undefined))
    .pipe(z.url().optional())
    .transform((s) => (s ? s.replace(/\/+$/, '') : undefined)),

  // Fallback local de NIST 800-63B §5.1.1.2: archivo de hashes SHA-1 (uno por línea) de la
  // lista top-100k de contraseñas comprometidas, generado con scripts/topPasswords.ts.
  // Ruta relativa a la raíz del proyecto. Ausente/al vacío → solo lista embebida + patrones.
  LOCAL_PASSWORD_LIST_PATH: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() !== '' ? s.trim() : undefined)),
})
  // Transforma el objeto completo a la estructura limpia de la API (fuente única del shape).
  .transform((data) => {
    // Origin público para los emails: PUBLIC_API_ORIGIN si está seteado (prod); si no, deriva
    // de HOST:PORT en dev. Config de confianza evaluada en boot — nunca el Host header del request.
    const apiOrigin: string = data.PUBLIC_API_ORIGIN ?? `http://${data.HOST}:${data.PORT}`;
    return {
      nodeEnv: data.NODE_ENV,
      port: data.PORT,
      host: data.HOST,
      jwtSecret: data.JWT_SECRET,
      accessTtlMinutes: data.ACCESS_TTL_MINUTES,
      refreshTtlDays: data.REFRESH_TTL_DAYS,
      google: {
        ...(data.GOOGLE_CLIENT_ID ? { clientId: data.GOOGLE_CLIENT_ID } : {}),
        issuer: data.GOOGLE_ISSUER,
        jwksUrl: data.GOOGLE_JWKS_URL,
      },
      dbPath: data.DB_PATH,
      corsOrigins: data.CORS_ORIGINS,
      rateLimit: {
        windowMs: data.RATE_LIMIT_WINDOW_MS,
        max: data.RATE_LIMIT_MAX,
        authWindowMs: data.RATE_LIMIT_AUTH_WINDOW_MS,
        authMax: data.RATE_LIMIT_AUTH_MAX,
      },
      magicLink: {
        ttlMinutes: data.MAGIC_LINK_TTL_MINUTES,
        consumeBaseUrl: `${apiOrigin}${API_PREFIX}${API_PATHS.magicLinkConsume}`,
        passwordResetConsumeBaseUrl: `${apiOrigin}${API_PREFIX}${API_PATHS.passwordReset}`,
      },
      localPasswordListPath: data.LOCAL_PASSWORD_LIST_PATH ?? 'data/top-100k-sha1.txt',
    };
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Falla de arranque: variables de entorno inválidas — nunca arrancar en silencio
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Configuración inválida:\n${issues}`);
  process.exit(1);
}

// Tipos derivados de la salida transformada de Zod: una sola fuente define el shape.
export type Config = z.infer<typeof envSchema>;
export type NodeEnv = Config['nodeEnv'];

export const config: Config = parsed.data;