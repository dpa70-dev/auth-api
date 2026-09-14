import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';

import { API_PREFIX, config } from './config.js';
import { LOG_EVENTS } from './domain/port/index.js';
import { composeInfra, type ComposeOverrides } from './infra/compose.js';
import { buildUseCases } from './app/buildUseCases.js';
import { PinoLogger, requestContext } from './infra/pinoLogger.js';

import { apiRouter } from './api/routes.js';
import { httpLoggerConfig, requestIdMiddleware } from './api/middlewares/middleware.js';
import { finalErrorHandler, notFound } from './api/middlewares/errorMiddleware.js';
import { globalLimiter } from './api/middlewares/rateLimiters.js';
import cookieParser from 'cookie-parser';

// Permite inyectar dependencias externas (útil en tests). Delega en composeInfra infra/compose.ts.
export type AppDeps = ComposeOverrides;

export const buildApp = (overrides: AppDeps = {}) => {
  const { users, hasher, tokens, google, magicLinks, sender, compromised, logger, close } = composeInfra(overrides);
  const useCases = buildUseCases({ users, hasher, tokens, google, magicLinks, sender, compromised }, logger);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));

  // Logging por request (pino-http) y propagación del requestId — defs en api/middlewares/middleware.ts.
  app.use(pinoHttp(httpLoggerConfig(new PinoLogger(config.nodeEnv).raw)));
  app.use(requestIdMiddleware(requestContext));

  app.use(API_PREFIX, globalLimiter(config));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.use(API_PREFIX, apiRouter(useCases, { tokens, config }));
  app.use(API_PREFIX, notFound);
  app.use(finalErrorHandler);

  return { app, close };
};

if (config.nodeEnv !== 'test') {
  const { app, close } = buildApp();
  const bootLogger = new PinoLogger(config.nodeEnv);
  const server = app.listen(config.port, config.host, () => {
    bootLogger.info(LOG_EVENTS.API_LISTENING, { url: `http://${config.host}:${config.port}${API_PREFIX}`, env: config.nodeEnv });
  });

  const shutdown = (signal: string) => {
    bootLogger.warn(LOG_EVENTS.SHUTDOWN_STARTED, { signal });
    server.close(() => {
      close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}