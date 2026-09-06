import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, MagicLinkRepository, PasswordHasher, TokenIssuer, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { userIdSchema, type PlainPassword } from '../../domain/vo/index.js';
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
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: ResetPasswordCommand): Promise<void> {
    const now = cmd.now ?? new Date();
    const tokenHash = await this.tokens.hashRefreshToken(cmd.token);
    const found = await this.magicLinks.findByTokenHash(tokenHash);

    // 401 idéntico para todo fallo (anti-enumeración + anti-reuso, patrón consume):
    // inexistente, no pendiente (ya usado/revocado), vencido o de otro propósito (login).
    if (!found) throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    if (found.status !== 'pending') {
      this.logger.warn(LOG_EVENTS.PASSWORD_RESET_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    if (found.expiresAt <= now.toISOString()) {
      this.logger.warn(LOG_EVENTS.PASSWORD_RESET_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    // F3 (aprobado): un link de login no restablece contraseña; el reset solo acepta purpose='password_reset'.
    if (found.purpose !== 'password_reset') {
      this.logger.warn(LOG_EVENTS.PASSWORD_RESET_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }

    const passwordHash = await this.hasher.hash(cmd.newPassword);

    let user = await this.users.findByEmail(found.email);
    if (user) {
      // Existe (local, solo-Google o mixta): el enlace prueba la posesión del email → se reemplaza/se asigna la contraseña.
      await this.users.updatePasswordHash(user.id, passwordHash);
    } else {
      // F2 (aprobado): email aún no registrado → auto-cuenta local, email probado por el enlace (coherente US-10).
      const id = userIdSchema.parse(randomUUID());
      await this.users.createUser({
        id,
        email: found.email,
        passwordHash,
        googleSub: null,
        emailVerified: true,
        createdAt: now.toISOString(),
      });
      user = await this.users.findById(id);
      this.logger.info(LOG_EVENTS.PASSWORD_RESET_REGISTERED, { userId: id });
    }
    // Guard defensivo: si no hay usuario (ni creación), fallo genérico (nunca `!`).
    if (!user) throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);

    // Un solo uso: consumir invalida el link (patrón consume).
    await this.magicLinks.markUsed(tokenHash);
    // F1 (misma política que change-password): el reset derriba TODAS las sesiones del usuario.
    await this.users.revokeFamily(user.id);

    this.logger.info(LOG_EVENTS.PASSWORD_RESET_CONSUMED, { userId: user.id });
  }
}