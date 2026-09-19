import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, PasswordHasher, TokenIssuer, UserRepository } from '../../domain/port/index.js';
import { familyIdSchema, providerSchema, userKindSchema, type Email, type PlainPassword, type UserId } from '../../domain/vo/index.js';
import { LOG_EVENTS, LOG_REASONS } from '../../domain/port/index.js';
import { issueSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

export type LoginCommand = {
  email: Email;
  password: PlainPassword;
  refreshTtlDays: number;
  now?: Date;
};

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email | null; kind: 'registered'; createdAt: string };
};

export class Login implements UseCase<LoginCommand, LoginResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: LoginCommand): Promise<LoginResult> {
    const now = cmd.now ?? new Date();

    const found = await this.users.findByEmail(cmd.email);

    // Anti-enumeración (doc 00 → ítem 41, US-02 AC-02/AC-03): email inexistente y contraseña
    // equivocada producen el MISMO 401 y consumen un tiempo equivalente (hash ficticio).
    const verified = await this.hasher.verify(cmd.password, found?.passwordHash ?? null);
    if (!found || !verified) {
      this.logger.warn(LOG_EVENTS.LOGIN_FAILED, { reason: found ? LOG_REASONS.BAD_PASSWORD : LOG_REASONS.UNKNOWN_EMAIL, email: cmd.email });
      throw new ApiError(ErrorCodes.INVALID_CREDENTIALS);
    }

    // US-08 AC-04: cuenta solo-Google intentando login local → 401 genérico (nunca revelar colisión).
    if (found.passwordHash === null) {
      this.logger.warn(LOG_EVENTS.LOGIN_FAILED, { reason: LOG_REASONS.GOOGLE_ONLY_USER, email: cmd.email });
      throw new ApiError(ErrorCodes.INVALID_CREDENTIALS);
    }

    const session = await issueSession(this.tokens, this.users, {
      userId: found.id,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.local,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    this.logger.info(LOG_EVENTS.USER_LOGGED_IN, { userId: found.id, provider: providerSchema.enum.local });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id: found.id, email: found.email, kind: userKindSchema.enum.registered, createdAt: found.createdAt },
    };
  }
}