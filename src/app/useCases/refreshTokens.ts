import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, TokenIssuer, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { isRefreshExpired } from '../../domain/refreshExpiry.js';
import { refreshTokenStatusSchema } from '../../domain/vo/index.js';
import { issueSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

export type RefreshTokensCommand = {
  refreshToken: string;
  refreshTtlDays: number;
  now?: Date;
};

export type RefreshTokensResult = {
  accessToken: string;
  refreshToken: string;
};

export class RefreshTokens implements UseCase<RefreshTokensCommand, RefreshTokensResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: RefreshTokensCommand): Promise<RefreshTokensResult> {
    const now = cmd.now ?? new Date();

    // US-03 AC-05: la BD guarda exclusivamente el hash SHA-256 del refresh opaco.
    const tokenHash = await this.tokens.hashRefreshToken(cmd.refreshToken);
    const found = await this.users.findByRefreshTokenHash(tokenHash);

    // AC-04: inexistente, vencido o revocado → 401 genérico idéntico (nunca revelar la causa).
    if (!found) throw new ApiError(ErrorCodes.UNAUTHORIZED);
    if (found.status === refreshTokenStatusSchema.enum.revoked || found.status === refreshTokenStatusSchema.enum.used) {
      // REUSO (AC-03): el mismo refresh presentado dos veces → 401 idéntico Y revocar toda la familia.
      await this.users.revokeFamily(found.userId);
      this.logger.warn(LOG_EVENTS.REFRESH_REUSE_DETECTED, { userId: found.userId, jti: found.jti });
      throw new ApiError(ErrorCodes.UNAUTHORIZED);
    }
    if (isRefreshExpired(found.expiresAt, now)) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED);
    }

    // AC-02 rotación: par NUEVO + invalidar el usado.
    await this.users.markRefreshTokenUsed(tokenHash);
    const session = await issueSession(this.tokens, this.users, {
      userId: found.userId,
      provider: found.provider,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    this.logger.info(LOG_EVENTS.TOKENS_REFRESHED, { userId: found.userId });
    return { accessToken: session.accessToken, refreshToken: session.refreshToken };
  }
}