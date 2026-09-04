import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Options as HttpLoggerOptions } from 'pino-http';
import type { Logger as PinoInstance } from 'pino';

/**
 * Contrato mínimo del contexto por request (implementado por infra con AsyncLocalStorage,
 * doc 00 → ítem 12). La presentación lo recibe inyectado y no conoce la implementación.
 */
export type RequestContext = {
  run: <T>(store: { requestId: string }, cb: () => T) => T;
};

/** Formato aceptado de x-request-id: alnum + `_ -`/`-`, 1..64 — evita log poisoning con headers arbitrarios. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Factory de la config de pino-http (doc 00 → ítem 11): log por request, requestId del contrato. */
export const httpLoggerConfig = (rawLogger: PinoInstance): HttpLoggerOptions => ({
  logger: rawLogger,
  genReqId: (req) => {
    const incoming = req.headers['x-request-id'];
    return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : `req_${randomUUID()}`;
  },
  customAttributeKeys: { reqId: 'requestId' },
  customLogLevel: (_req, res, err) => {
    if (err !== undefined) return 'error';
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: { ignore: (req) => req.url === '/favicon.ico' },
});

/**
 * Propaga el requestId a req.requestId (envelope 4xx/5xx) y al contexto por request (ALS)
 * para enriquecer los logs de los casos de uso — doc 00 → ítem 12.
 */
export const requestIdMiddleware = (context: RequestContext): RequestHandler => {
  return (req, _res, next) => {
    const requestId = String(req.id);
    req.requestId = requestId;
    context.run({ requestId }, next);
  };
};
