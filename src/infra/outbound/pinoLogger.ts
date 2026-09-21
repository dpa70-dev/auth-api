import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { z } from 'zod';
import { pino, type LevelWithSilent, type Logger as PinoInstance, type LoggerOptions } from 'pino';
import type { Logger } from '../../domain/port/index.js';
import { nodeEnvSchema, type NodeEnv } from '../../config.js';

/**
 * Contexto por request (doc 00 → ítem 12): el requestId enriquece cada log de la request.
 * Lo rellena un middleware en index.ts con el `req.id` que genera pino-http (genReqId).
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** Niveles de log de la app (doc 00 → ítem 14): fuente única — pino acepta trace/warn/error/fatal, la app solo usa estos tres. */
export const logLevelValues = ['silent', 'debug', 'info'] as const;

export const logLevelSchema = z.enum(logLevelValues);

export type LogLevel = z.infer<typeof logLevelSchema>;

/** Nivel por entorno (doc 00 → ítem 14): record exhaustivo — agregar un entorno sin nivel aquí falla en compilación (patrón STATUS_BY_CODE). */
const LEVEL_BY_NODE_ENV: Record<NodeEnv, LogLevel> = {
  [nodeEnvSchema.enum.development]: logLevelSchema.enum.debug,
  [nodeEnvSchema.enum.test]: logLevelSchema.enum.silent,
  [nodeEnvSchema.enum.production]: logLevelSchema.enum.info,
};

/**
 * Implementa el puerto Logger con pino 10 (doc 00 → ítems 10-15): una línea JSON por
 * evento, niveles por entorno, redact de datos sensibles y pino-pretty en dev.
 */
export class PinoLogger implements Logger {
  /** Instancia pino cruda: la consume pino-http para los accesos (doc 00 → ítem 11). */
  readonly raw: PinoInstance;

  constructor(private readonly nodeEnv: NodeEnv) {
    // doc 00 → ítem 14: test → silent (los tests inyectan su propio logger), dev → debug + pretty, prod → info.
    const level: LevelWithSilent = LEVEL_BY_NODE_ENV[this.nodeEnv];

    const options: LoggerOptions = {
      level,
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        // doc 00 → ítem 13: redact de password, refreshToken, authorization y emails.
        // pino-http serializa todos los headers del request en el access log → req.headers.authorization.
        paths: ['password', 'refreshToken', 'authorization', 'req.headers.authorization', 'req.headers.cookie', '*.email', 'email', 'idToken'],
        censor: '[REDACTED]',
      },
    };

    if (this.nodeEnv === nodeEnvSchema.enum.development) {
      options.transport = {
        targets: [
          {
            target: 'pino-roll',
            options: {
              file: join('logs', 'app-'),
              frequency: 'daily',
              dateFormat: 'yyyy-MM-dd',
              mkdir: true,
            },
            level: logLevelSchema.enum.debug,
          },
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
            level: logLevelSchema.enum.debug,
          },
        ],
      };
    }

    this.raw = pino(options);
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    this.raw.info(this.withRequestId(ctx), msg);
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.raw.warn(this.withRequestId(ctx), msg);
  }

  error(msg: string, ctx?: Record<string, unknown>): void {
    this.raw.error(this.withRequestId(ctx), msg);
  }

  /** Enriquecer con requestId del ALS (doc 00 → ítem 12) — no-op fuera de una request. */
  private withRequestId(ctx?: Record<string, unknown>): Record<string, unknown> {
    const store = requestContext.getStore();
    return store ? { ...ctx, requestId: store.requestId } : (ctx ?? {});
  }
}