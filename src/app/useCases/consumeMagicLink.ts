import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, MagicLinkRepository, TokenIssuer, UnitOfWork, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { familyIdSchema, magicLinkPurposeSchema, magicLinkStatusSchema, providerSchema, userIdSchema, userKindSchema, type Email, type UserId } from '../../domain/vo/index.js';
import { generateSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

export type ConsumeMagicLinkCommand = {
  token: string;
  refreshTtlDays: number;
  now?: Date;
};

export type ConsumeMagicLinkResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email | null; kind: 'registered'; createdAt: string };
};

export class ConsumeMagicLink implements UseCase<ConsumeMagicLinkCommand, ConsumeMagicLinkResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly magicLinks: MagicLinkRepository,
    private readonly tokens: TokenIssuer,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: ConsumeMagicLinkCommand): Promise<ConsumeMagicLinkResult> {
    const now = cmd.now ?? new Date();
    // Hashing del token FUERA de la tx (doc 13 → §13.1): crypto nunca dentro de BEGIN/COMMIT.
    const tokenHash = await this.tokens.hashRefreshToken(cmd.token);
    const found = await this.magicLinks.findByTokenHash(tokenHash);

    // 401 idéntico para todo fallo (anti-enumeración + anti-reuso, patrón del refresh):
    // inexistente, no pendiente (ya usado/revocado) o vencido — nunca revelar la causa.
    if (!found) throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    if (found.status !== magicLinkStatusSchema.enum.pending) {
      this.logger.warn(LOG_EVENTS.MAGIC_LINK_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    if (found.expiresAt <= now.toISOString()) {
      this.logger.warn(LOG_EVENTS.MAGIC_LINK_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }
    // F3 (aprobado): un link de reset no crea sesiones. El consumo de login solo acepta purpose='login'
    // — un link de password_reset presentado aquí es tan inválido como un token desconocido.
    if (found.purpose !== magicLinkPurposeSchema.enum.login) {
      this.logger.warn(LOG_EVENTS.MAGIC_LINK_INVALID_ATTEMPT, { email: found.email });
      throw new ApiError(ErrorCodes.MAGIC_LINK_INVALID);
    }

    // Estado actual fuera de la tx; las escrituras que dependen de él se ejecutan de forma atómica.
    const user = await this.users.findByEmail(found.email);
    const userId = user ? user.id : userIdSchema.parse(randomUUID());

    // Sesión (jose) FUERA de la tx — la persistencia del refresh row va dentro de la transacción.
    const session = await generateSession(this.tokens, {
      userId,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.magic,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    // Escrituras atómicas (doc 13 → §13.1): crear/verificar usuario + consumo del link + refresh
    // token. Un fallo a mitad deja la BD intacta (ROLLBACK).
    await this.unitOfWork.withTransaction(async () => {
      if (user) {
        await this.users.markEmailVerified(found.email);
      } else {
        // Auto-cuenta (US-10): el clic en el link prueba la posesión del email → emailVerified=true.
        await this.users.createUser({
          id: userId,
          email: found.email,
          passwordHash: null,
          googleSub: null,
          emailVerified: true,
          kind: userKindSchema.enum.registered,
          createdAt: now.toISOString(),
        });
        this.logger.info(LOG_EVENTS.USER_REGISTERED_VIA_MAGIC_LINK, { userId });
      }
      // Un solo uso: consumir invalida el link.
      await this.magicLinks.markUsed(tokenHash);
      await this.users.insertRefreshToken(session.refreshRow);
    });

    this.logger.info(LOG_EVENTS.MAGIC_LINK_CONSUMED, { userId });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id: userId, email: user ? user.email : found.email, kind: userKindSchema.enum.registered, createdAt: user ? user.createdAt : now.toISOString() },
    };
  }
}