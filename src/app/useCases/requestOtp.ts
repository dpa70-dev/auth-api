import { randomInt, randomUUID } from 'node:crypto';
import type { EmailSender, Logger, OtpRepository, PasswordHasher } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { expiresAtIso, minutesToMs } from '../../domain/time.js';
import { otpCodeSchema, type Email } from '../../domain/vo/index.js';
import type { UseCase } from '../interfaces/useCase.js';

export type RequestOtpCommand = {
  email: Email;
  /** TTL en minutos del código desde la emisión (config.ts → OTP_TTL_MINUTES). */
  otpTtlMinutes: number;
  now?: Date;
};

export type RequestOtpResult = { ok: true };

/**
 * Solicita un código OTP de 6 dígitos (US-13). ANTI-ENUMERACIÓN (doc 00 → ítem 41): responde
 * 200 { ok: true } idéntico SIEMPRE y realiza la MISMA cantidad de trabajo (generar, hashear,
 * persistir, enviar) con o sin cuenta registrada — un atacante no distingue por la respuesta.
 * Un solo código pendiente por email: revocar el anterior antes de insertar invalida códigos
 * emitidos previamente (rotación). La auto-cuenta (US-14) se resuelve en el verify.
 */
export class RequestOtp implements UseCase<RequestOtpCommand, RequestOtpResult> {
  constructor(
    private readonly otpCodes: OtpRepository,
    private readonly hasher: PasswordHasher,
    private readonly sender: EmailSender,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: RequestOtpCommand): Promise<RequestOtpResult> {
    const now = cmd.now ?? new Date();

    // Código de 6 dígitos '000000'..'999999' (doc 00 → ítem 34): aleatorio uniforme.
    const rawCode = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const code = otpCodeSchema.parse(rawCode);
    // Hash argon2id (lento) FUERA de la tx (doc 13 → §13.1): nunca crypto dentro de BEGIN/COMMIT.
    const codeHash = await this.hasher.hash(code);
    const expiresAt = expiresAtIso(now, minutesToMs(cmd.otpTtlMinutes));
    await this.otpCodes.revokeAllForEmail(cmd.email);
    await this.otpCodes.insert({ id: randomUUID(), email: cmd.email, codeHash, expiresAt });
    await this.sender.sendOtpCode({ to: cmd.email, code: rawCode });

    this.logger.info(LOG_EVENTS.OTP_REQUESTED, { email: cmd.email, ttlMinutes: cmd.otpTtlMinutes, expiresAt });

    return { ok: true };
  }
}