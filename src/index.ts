import 'dotenv/config';

import { API_PREFIX, config } from './config.js';
import { LOG_EVENTS } from './domain/port/index.js';
import { PinoLogger } from './infra/outbound/pinoLogger.js';
import { buildApp } from './api/appBuilder.js';

export { buildApp } from './api/appBuilder.js';
export type { AppDeps } from './api/appBuilder.js';

if (config.nodeEnv !== 'test') {
  const { app, close } = buildApp();
  const bootLogger = new PinoLogger(config.nodeEnv);
  const server = app.listen(config.port, config.host, () => {
    bootLogger.info(LOG_EVENTS.API_LISTENING, {
      url: `http://${config.host}:${config.port}${API_PREFIX}`,
      env: config.nodeEnv,
    });
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
