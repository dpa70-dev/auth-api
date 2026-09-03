// Setup de tests: la config (src/config.ts) se parsea al importarse, así que el env
// debe estar listo antes de cargar el módulo bajo test (vitest ejecuta setupFiles primero).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-de-32-caracteres-como-minimo!';
process.env.ACCESS_TTL_MINUTES = '5';
process.env.REFRESH_TTL_DAYS = '30';
process.env.DB_PATH = ':memory:';
process.env.RATE_LIMIT_AUTH_MAX = '10';
process.env.RATE_LIMIT_AUTH_WINDOW_MS = '60000';