import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import cookieParser from 'cookie-parser';

import { API_PREFIX, config } from '../config.js';
import { composeInfra, type ComposeOverrides } from '../infra/compose.js';
import { buildUseCases } from '../app/buildUseCases.js';
import { PinoLogger, requestContext } from '../infra/outbound/pinoLogger.js';

import { apiRouter } from './routes.js';
import { httpLoggerConfig, requestIdMiddleware } from './middlewares/middleware.js';
import { finalErrorHandler, notFound } from './middlewares/errorMiddleware.js';
import { globalLimiter } from './middlewares/rateLimiters.js';

export type AppDeps = ComposeOverrides;

export const buildApp = (overrides: AppDeps = {}) => {
  const {
    users,
    refreshTokens,
    hasher,
    tokens,
    google,
    magicLinks,
    otpCodes,
    sender,
    compromised,
    unitOfWork,
    logger,
    close,
  } = composeInfra(overrides);
  const useCases = buildUseCases(
    { users, refreshTokens, hasher, tokens, google, magicLinks, otpCodes, sender, compromised, unitOfWork },
    logger,
  );

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

  app.use(API_PREFIX, apiRouter(useCases, { tokens, users, config }));
  app.use(API_PREFIX, notFound);
  app.use(finalErrorHandler);

  return { app, close };
};
