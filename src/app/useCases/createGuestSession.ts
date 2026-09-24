import { randomUUID } from 'node:crypto';
import type { Logger, TokenIssuer, UnitOfWork, UserRepository, RefreshTokenRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { familyIdSchema, providerSchema, userIdSchema, userKindSchema, userRoleSchema, userStatusSchema, type Email, type UserId } from '../../domain/vo/index.js';
import { validateNewUser } from '../../domain/entity/user.js';
import { generateSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

export type CreateGuestSessionCommand = {
  refreshTtlDays: number;
  now?: Date;
};

export type CreateGuestSessionResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email | null; kind: 'guest'; createdAt: string };
};

/**
 * US-15: crea una cuenta anónima (kind 'guest', sin email ni identidad) y emite una sesión
 * con provider 'guest'. El guest puede reclamar email+password después vía UpgradeGuestAccount
 * (US-16) — la sesión persiste (decisión aprobada: NO se revoca en el upgrade).
 */
export class CreateGuestSession implements UseCase<CreateGuestSessionCommand, CreateGuestSessionResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenIssuer,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
    private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  async execute(cmd: CreateGuestSessionCommand): Promise<CreateGuestSessionResult> {
    const now = cmd.now ?? new Date();
    const id = userIdSchema.parse(randomUUID());

    // Sesión (jose) FUERA de la tx — solo se persiste el refresh row dentro de la transacción.
    const session = await generateSession(this.tokens, {
      userId: id,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.guest,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    // Escrituras atómicas (doc 13 → §13.1): guest + refresh token se crean juntos o no se crea ninguno.
    await this.unitOfWork.withTransaction(async () => {
      await this.users.createUser({
        ...validateNewUser({
          id,
          email: null,
          passwordHash: null,
          googleSub: null,
          emailVerified: false,
          kind: userKindSchema.enum.guest,
          role: userRoleSchema.enum.user,
          status: userStatusSchema.enum.active,
        }),
        createdAt: now.toISOString(),
      });
      await this.refreshTokens.insertRefreshToken(session.refreshRow);
    });

    this.logger.info(LOG_EVENTS.GUEST_SESSION_CREATED, { userId: id });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id, email: null, kind: userKindSchema.enum.guest, createdAt: now.toISOString() },
    };
  }
}