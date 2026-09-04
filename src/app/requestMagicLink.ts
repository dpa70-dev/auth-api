import { randomBytes, randomUUID } from 'node:crypto';
import type {
  EmailSender,
  Logger,
  MagicLinkRepository,
  TokenIssuer,
} from '../domain/port/index.js';
import { LOG_EVENTS } from '../domain/port/index.js';
import { emailSchema } from '../domain/vo/index.js';

export type RequestMagicLinkCommand = {
  email: string;
  /** TTL en minutos de validez del link desde la emisión. */
  magicLinkTtlMinutes: number;
  /** Base pública del endpoint de consumo; se construye la URL con ?token=<opaco>. */
  consumeBaseUrl: string;
  now?: Date;
};

export type RequestMagicLinkResult = { ok: true };

/**
 * Solicita un magic link (US-09). ANTI-ENUMERACIÓN (doc 00 → ítem 41): el request responde
 * 200 { ok: true } idéntico SIEMPRE y realiza la MISMA cantidad de trabajo (generar token,
 * persistir hash, enviar email) con o sin cuenta registrada, para que un atacante no pueda
 * distinguir por la respuesta ni por side-channel temporal si el email está registrado.
 * La auto-cuenta (US-10) se resuelve en el consume: un enlace enviado a un email aún no
 * registrado crea la cuenta al validarse.
 */
export class RequestMagicLink {
  constructor(
    private readonly magicLinks: MagicLinkRepository,
    private readonly tokens: TokenIssuer,
    private readonly sender: EmailSender,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: RequestMagicLinkCommand): Promise<RequestMagicLinkResult> {
    const email = emailSchema.parse(cmd.email);
    const now = cmd.now ?? new Date();

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = await this.tokens.hashRefreshToken(rawToken);
    const expiresAt = new Date(now.getTime() + cmd.magicLinkTtlMinutes * 60 * 1000).toISOString();
    await this.magicLinks.insert({
      id: randomUUID(),
      tokenHash,
      email,
      expiresAt,
    });
    const url = `${cmd.consumeBaseUrl}?token=${rawToken}`;
    await this.sender.sendMagicLink({ to: email, url });

    this.logger.info(LOG_EVENTS.MAGIC_LINK_REQUESTED, { email, ttlMinutes: cmd.magicLinkTtlMinutes, expiresAt });
    return { ok: true };
  }
}
