/**
 * Grençada de salida para envío de email (doc 00 → ítems 55+). El dominio no conoce SMTP:
 * la infraestructura implementa el transporte. En esta etapa la impl loguea a consola
 * (dev/test) y queda lista para conectar un proveedor real (SMTP/Resend) sin tocar el dominio.
 */
import type { Email } from '../vo/index.js';

export interface EmailSender {
  /** Envía un magic link de acceso. El token NUNCA debe filtrarse al logger del consumidor. */
  sendMagicLink(input: { to: Email; url: string }): Promise<void>;
}
