import { z } from 'zod';
import 'dotenv/config';

// Esquema de las variables de entorno: valida, aplica defaults y transforma al shape limpio.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

  // Magic link (doc 05 → magic link): TTL en minutos y base pública del endpoint de consumo.
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().max(60).default(15),
  MAGIC_LINK_CONSUME_BASE_URL: z
    .url()
    .default('http://localhost:3000/api/v1/auth/magic-link/consume'),
})
  // Transforma el objeto completo a la estructura limpia de la API (fuente única del shape).
  .transform((data) => ({
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
      consumeBaseUrl: data.MAGIC_LINK_CONSUME_BASE_URL,
    },
  }));

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