import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { CompromisedPasswordChecker, Logger, PasswordHasher, RefreshTokenRepository, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS, LOG_REASONS } from '../../domain/port/index.js';
import type { PlainPassword, UserId } from '../../domain/vo/index.js';
import type { UseCase } from '../interfaces/useCase.js';

export type ChangePasswordCommand = {
  userId: UserId;
  currentPassword: PlainPassword;
  newPassword: PlainPassword;
};

/**
 * US-11: cambia la contraseña probando la actual (el reto de un secreto que ya se posee).
 * F1 (aprobado): el cambio derriba TODAS las sesiones del usuario (revokeAllForUser) —
 * compensa sesiones que quedaron emitidas bajo el secreto viejo; el cliente re-autentica.
 */
export class ChangePassword implements UseCase<ChangePasswordCommand, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly compromised: CompromisedPasswordChecker,
    private readonly logger: Logger,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(cmd: ChangePasswordCommand): Promise<void> {
    const user = await this.users.findById(cmd.userId);
    // Guard defensivo: requireAuth garantizó la existencia; si el usuario desapareció, 401 genérico.
    if (!user) throw new ApiError(ErrorCodes.UNAUTHORIZED);

    // Cuenta solo-Google (passwordHash null): no hay currentPassword que probar → 409 explícito.
    if (user.passwordHash === null) throw new ApiError(ErrorCodes.ACCOUNT_HAS_NO_PASSWORD);

    const verified = await this.hasher.verify(cmd.currentPassword, user.passwordHash);
    // Contraseña actual incorrecta → 401 genérico (misma semántica que login) + log del intento fallido.
    if (!verified) {
      this.logger.warn(LOG_EVENTS.PASSWORD_CHANGE_FAILED, { reason: LOG_REASONS.PASSWORD_MISMATCH, userId: user.id });
      throw new ApiError(ErrorCodes.INVALID_CREDENTIALS);
    }

    // NIST 800-63B §5.1.1.2: la contraseña nueva no puede estar en filtraciones conocidas.
    if ((await this.compromised.check(cmd.newPassword)) === 'compromised') {
      this.logger.warn(LOG_EVENTS.PASSWORD_COMPROMISED_REJECTED, { userId: user.id });
      throw new ApiError(ErrorCodes.PASSWORD_COMPROMISED, {
        details: [{ field: 'newPassword', issue: 'compromised' }],
      });
    }

    const passwordHash = await this.hasher.hash(cmd.newPassword);
    await this.users.updatePasswordHash(user.id, passwordHash);
    await this.refreshTokens.revokeAllForUser(user.id);

    this.logger.info(LOG_EVENTS.PASSWORD_CHANGED, { userId: user.id });
  }
}