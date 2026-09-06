import type { EmailSender, Logger } from '../domain/port/index.js';
import { LOG_EVENTS } from '../domain/port/index.js';
import type { Email } from '../domain/vo/index.js';

/**
 * Implementación de dev/test del puerto EmailSender: en lugar de un transporte SMTP real
 * (nodemailer/Resend, aún no configurado), loguea la URL del email a consola para poder
 * usarla en desarrollo. El token viaja en la URL; no se persiste en logs aparte de este envío.
 */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  async sendMagicLink({ to, url }: { to: Email; url: string }): Promise<void> {
    this.logger.info(LOG_EVENTS.MAGIC_LINK_REQUESTED, { to, url });
  }

  async sendPasswordResetEmail({ to, url }: { to: Email; url: string }): Promise<void> {
    this.logger.info(LOG_EVENTS.PASSWORD_RESET_REQUESTED, { to, url });
  }
}