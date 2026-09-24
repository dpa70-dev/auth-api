import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { CompromisedPasswordChecker, Logger, MagicLinkRepository, PasswordHasher, RefreshTokenRepository, TokenIssuer, UnitOfWork, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { magicLinkPurposeSchema, magicLinkStatusSchema, userIdSchema, userKindSchema, type PlainPassword } from '../../domain/vo/index.js';
import { validateNewUser } from '../../domain/entity/user.js';
import type { UseCase } from '../interfaces/useCase.js';

export type ResetPasswordCommand = {
  token: string;
  newPassword: PlainPassword;
  now?: Date;
};

/**
 * US-12: consume un magic link de propósito password_reset y reemplaza (o asigna) la contraseña.
 * NO emite sesión: el frontend redirige al login con el secreto nuevo, evitando que el flujo
 * "olvidé" cree una sesión sin pasar por el login. F1: el reset derriba TODAS las sesiones.
 */
export class ResetPassword implements UseCase<ResetPasswordCommand, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly magicLinks: MagicLinkRepository,
    private readonly hasher: PasswordHasher,
    private readonly compromised: CompromisedPasswordChecker,
    private readonly tokens: TokenIssuer,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(cmd: ResetPasswordCommand): Promise<void> {
    const now = cmd.now ?? new Date();
    // Hashing del token FUERA de la tx (doc 13 → §13.1): crypto nunca dentro de BEGIN/COMMIT.
    const tokenHash = await this.tokens.hashRefreshToken(cmd.token);
    const found = await this.magicLinks.findByTokenHash(tokenHash);

    // 401 idéntico para todo fallo (anti-enumeración + anti-reuso, patrón consume):
    // inexistente, no pendiente (ya usado/revocado), vencido o de otro propósito (login).
    if (!found) throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    if (found.status !== magicLinkStatusSchema.enum.pending) {
      this.logger.warn(LOG_EVENTS.PASSWORD_RESET_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    if (found.expiresAt <= now.toISOString()) {
      this.logger.warn(LOG_EVENTS.PASSWORD_RESET_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    // F3 (aprobado): un link de login no restablece contraseña; el reset solo acepta purpose='password_reset'.
    if (found.purpose !== magicLinkPurposeSchema.enum.password_reset) {
      this.logger.warn(LOG_EVENTS.PASSWORD_RESET_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }

    // NIST 800-63B §5.1.1.2: filtrar contraseñas comprometidas antes de persistir el hash.
    if ((await this.compromised.check(cmd.newPassword)) === 'compromised') {
      this.logger.warn(LOG_EVENTS.PASSWORD_COMPROMISED_REJECTED, { email: found.email });
      throw new ApiError(ErrorCodes.PASSWORD_COMPROMISED, {
        details: [{ field: 'password', issue: 'compromised' }],
      });
    }

    // Crypto (argon2) FUERA de la tx (doc 13 → §13.1).
    const passwordHash = await this.hasher.hash(cmd.newPassword);

    const user = await this.users.findByEmail(found.email);
    const userId = user ? user.id : userIdSchema.parse(randomUUID());

    // Escrituras atómicas (doc 13 → §13.1): asignar hash + consumo del link + revocación total de
    // sesiones. Un fallo a mitad deja la BD intacta (ROLLBACK) — el hash nunca queda "huérfano".
    await this.unitOfWork.withTransaction(async () => {
      if (user) {
        // Existe (local, solo-Google o mixta): el enlace prueba la posesión del email → se reemplaza/se asigna la contraseña.
        await this.users.updatePasswordHash(userId, passwordHash);
      } else {
        // F2 (aprobado): email aún no registrado → auto-cuenta local, email probado por el enlace (coherente US-10).
        await this.users.createUser({
          ...validateNewUser({
            id: userId,
            email: found.email,
            passwordHash,
            googleSub: null,
            emailVerified: true,
            kind: userKindSchema.enum.registered,
          }),
          createdAt: now.toISOString(),
        });
        this.logger.info(LOG_EVENTS.PASSWORD_RESET_REGISTERED, { userId });
      }
      // Un solo uso: consumir invalida el link (patrón consume).
      await this.magicLinks.markUsed(tokenHash);
      // F1 (misma política que change-password): el reset derriba TODAS las sesiones del usuario.
      await this.refreshTokens.revokeAllForUser(userId);
    });

    this.logger.info(LOG_EVENTS.PASSWORD_RESET_CONSUMED, { userId });
  }
}