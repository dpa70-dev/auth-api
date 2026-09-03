import type { LogEventName } from './logEvents.js';

/** Contrato de logging que la infraestructura implementa (doc 00 → ítem 10: pino). */
export interface Logger {
  info(msg: LogEventName, ctx?: Record<string, unknown>): void;
  warn(msg: LogEventName, ctx?: Record<string, unknown>): void;
  error(msg: LogEventName, ctx?: Record<string, unknown>): void;
}