import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import { pino, type LevelWithSilent, type Logger as PinoInstance, type LoggerOptions } from 'pino';
import type { Logger } from '../domain/port/index.js';
import type { NodeEnv } from '../config.js';

/**
 * Contexto por request (doc 00 → ítem 12): el requestId enriquece cada log de la request.
 * Lo rellena un middleware en index.ts con el `req.id` que genera pino-http (genReqId).
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Implementa el puerto Logger con pino 10 (doc 00 → ítems 10-15): una línea JSON por
 * evento, niveles por entorno, redact de datos sensibles y pino-pretty en dev.
 */
export class PinoLogger implements Logger {
  /** Instancia pino cruda: la consume pino-http para los accesos (doc 00 → ítem 11). */
  readonly raw: PinoInstance;

  constructor(private readonly nodeEnv: NodeEnv) {
    // doc 00 → ítem 14: test → silent (los tests inyectan su propio logger), dev → debug + pretty, prod → info.
    const level: LevelWithSilent = this.nodeEnv === 'test' ? 'silent' : this.nodeEnv === 'development' ? 'debug' : 'info';

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

    if (this.nodeEnv === 'development') {
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
            level: 'debug',
          },
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
            level: 'debug',
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