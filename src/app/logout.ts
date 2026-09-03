import { ApiError } from '../domain/apiError.js';
import { ErrorCodes } from '../domain/errorCatalog.js';
import type { Logger, TokenIssuer, UserRepository } from '../domain/port/index.js';
import { LOG_EVENTS } from '../domain/port/index.js';
import { isRefreshExpired } from '../domain/refreshExpiry.js';

export type LogoutCommand = {
  refreshToken: string;
  now?: Date;
};

export class Logout {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  /**
   * US-04: revoca el refresh en base. Soft-revoke (status='revoked', NUNCA DELETE): si el token
   * se borrara, presentarlo después sería "inexistente" y no podría disparar la revocación de
   * familia del reuso (AC-02, doc 04 → decisión 3).
   */
  async execute(cmd: LogoutCommand): Promise<void> {
    const now = cmd.now ?? new Date();
    const tokenHash = await this.tokens.hashRefreshToken(cmd.refreshToken);
    const found = await this.users.findByRefreshTokenHash(tokenHash);

    // 401 genérico: token ausente/desconocido (semántica transversal, AC-03).
    if (!found || found.status !== 'active') throw new ApiError(ErrorCodes.UNAUTHORIZED);
    if (isRefreshExpired(found.expiresAt, now)) throw new ApiError(ErrorCodes.UNAUTHORIZED);

    await this.users.revokeRefreshToken(tokenHash);
    this.logger.info(LOG_EVENTS.USER_LOGGED_OUT, { userId: found.userId, jti: found.jti });
  }
}