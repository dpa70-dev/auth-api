import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, MagicLinkRepository, TokenIssuer, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { providerSchema, userIdSchema, type Email, type UserId } from '../../domain/vo/index.js';
import { issueSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

export type ConsumeMagicLinkCommand = {
  token: string;
  refreshTtlDays: number;
  now?: Date;
};

export type ConsumeMagicLinkResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email; createdAt: string };
};

export class ConsumeMagicLink implements UseCase<ConsumeMagicLinkCommand, ConsumeMagicLinkResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly magicLinks: MagicLinkRepository,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: ConsumeMagicLinkCommand): Promise<ConsumeMagicLinkResult> {
    const now = cmd.now ?? new Date();
    const tokenHash = await this.tokens.hashRefreshToken(cmd.token);
    const found = await this.magicLinks.findByTokenHash(tokenHash);

    // 401 idéntico para todo fallo (anti-enumeración + anti-reuso, patrón del refresh):
    // inexistente, no pendiente (ya usado/revocado) o vencido — nunca revelar la causa.
    if (!found) throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    if (found.status !== 'pending') {
      this.logger.warn(LOG_EVENTS.MAGIC_LINK_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    if (found.expiresAt <= now.toISOString()) {
      this.logger.warn(LOG_EVENTS.MAGIC_LINK_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }

    let user = await this.users.findByEmail(found.email);
    if (user) {
      await this.users.markEmailVerified(found.email);
    } else {
      // Auto-cuenta (US-10): el clic en el link prueba la posesión del email → emailVerified=true.
      const id = userIdSchema.parse(randomUUID());
      await this.users.createUser({
        id,
        email: found.email,
        passwordHash: null,
        googleSub: null,
        emailVerified: true,
        createdAt: now.toISOString(),
      });
      user = await this.users.findById(id);
      this.logger.info(LOG_EVENTS.USER_REGISTERED_VIA_MAGIC_LINK, { userId: id });
    }
    // Guard defensivo: si no hay usuario (ni creación), fallo genérico (nunca `!`).
    if (!user) throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);

    // Un solo uso: consumir invalida el link.
    await this.magicLinks.markUsed(tokenHash);

    const session = await issueSession(this.tokens, this.users, {
      userId: user.id,
      provider: providerSchema.enum.magic,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    this.logger.info(LOG_EVENTS.MAGIC_LINK_CONSUMED, { userId: user.id });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    };
  }
}