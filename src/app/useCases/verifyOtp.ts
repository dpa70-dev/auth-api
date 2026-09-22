import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, OtpRepository, PasswordHasher, TokenIssuer, UnitOfWork, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { familyIdSchema, otpStatusSchema, providerSchema, userIdSchema, userKindSchema, type Email, type OtpCode, type UserId } from '../../domain/vo/index.js';
import { validateNewUser } from '../../domain/entity/user.js';
import { generateSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

/** Intentos fallidos máximos antes de invalidar el código (doc 00 → ítem 34): 10^6 códigos / 5 intentos. */
export const OTP_MAX_ATTEMPTS = 5;

export type VerifyOtpCommand = {
  email: Email;
  code: OtpCode;
  refreshTtlDays: number;
  now?: Date;
};

export type VerifyOtpResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email | null; kind: 'registered'; createdAt: string };
};

/**
 * Verifica un código OTP y emite sesión (US-14). 401 OTP_INVALID idéntico para TODO fallo
 * (inexistente/vencido/usado/código incorrecto/intentos agotados) — anti-enumeración y
 * anti-bruteforce: nunca revelar la causa. Límite de intentos: al alcanzarlo el código se
 * revoca y fuerza un nuevo request. Auto-cuenta (espejo US-10): email no registrado →
 * usuario sin password con emailVerified=true (el código prueba la posesión del email).
 */
export class VerifyOtp implements UseCase<VerifyOtpCommand, VerifyOtpResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly otpCodes: OtpRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: VerifyOtpCommand): Promise<VerifyOtpResult> {
    const now = cmd.now ?? new Date();

    // Solo encuentra pendientes NO expirados; inexistente/vencido/usado colapsan en el mismo null.
    const found = await this.otpCodes.findPendingByEmail(cmd.email, now.toISOString());
    if (!found) {
      this.logger.warn(LOG_EVENTS.OTP_INVALID_ATTEMPT, { email: cmd.email });
      throw new ApiError(ErrorCodes.OTP_INVALID);
    }
    // Intentos agotados: revocar el código impide seguirlo probando y fuerza un nuevo request.
    if (found.attempts >= OTP_MAX_ATTEMPTS) {
      await this.otpCodes.markStatus(found.id, otpStatusSchema.enum.revoked);
      this.logger.warn(LOG_EVENTS.OTP_INVALID_ATTEMPT, { email: cmd.email, attempts: found.attempts });
      throw new ApiError(ErrorCodes.OTP_INVALID);
    }
    // Verificación argon2 (lenta) FUERA de la tx (doc 13 → §13.1); fallo → intento contabilizado.
    const valid = await this.hasher.verify(cmd.code, found.codeHash);
    if (!valid) {
      await this.otpCodes.incrementAttempts(found.id);
      this.logger.warn(LOG_EVENTS.OTP_INVALID_ATTEMPT, { email: cmd.email, attempts: found.attempts + 1 });
      throw new ApiError(ErrorCodes.OTP_INVALID);
    }

    // Estado actual (usuario) FUERA de la tx; las escrituras que dependen de él van atómicas dentro.
    const user = await this.users.findByEmail(cmd.email);
    const userId = user ? user.id : userIdSchema.parse(randomUUID());

    // Sesión (jose) FUERA de la tx — la persistencia del refresh row va dentro de la transacción.
    const session = await generateSession(this.tokens, {
      userId,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.otp,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    // Escrituras atómicas (doc 13 → §13.1): auto-cuenta/verificación + consumo del código + refresh.
    await this.unitOfWork.withTransaction(async () => {
      if (user) {
        await this.users.markEmailVerified(cmd.email);
      } else {
        // Auto-cuenta (US-14): el código verificado prueba la posesión del email → emailVerified=true.
        await this.users.createUser({
          ...validateNewUser({
            id: userId,
            email: cmd.email,
            passwordHash: null,
            googleSub: null,
            emailVerified: true,
            kind: userKindSchema.enum.registered,
          }),
          createdAt: now.toISOString(),
        });
        this.logger.info(LOG_EVENTS.USER_REGISTERED_VIA_OTP, { userId });
      }
      // Un solo uso: verificar invalida el código.
      await this.otpCodes.markStatus(found.id, otpStatusSchema.enum.used);
      await this.users.insertRefreshToken(session.refreshRow);
    });

    this.logger.info(LOG_EVENTS.OTP_VERIFIED, { userId });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id: userId, email: user ? user.email : cmd.email, kind: userKindSchema.enum.registered, createdAt: user ? user.createdAt : now.toISOString() },
    };
  }
}