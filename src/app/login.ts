import { ApiError } from '../domain/apiError.js';
import { ErrorCodes } from '../domain/errorCatalog.js';
import type { Logger, PasswordHasher, TokenIssuer, UserRepository } from '../domain/port/index.js';
import { emailSchema, plainPasswordSchema, providerSchema, type Email, type UserId } from '../domain/vo/index.js';
import { LOG_EVENTS, LOG_REASONS } from '../domain/port/index.js';
import { issueSession } from './issueSession.js';

export type LoginCommand = {
  email: string;
  password: string;
  refreshTtlDays: number;
  now?: Date;
};

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email; createdAt: string };
};

export class Login {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: LoginCommand): Promise<LoginResult> {
    const email = emailSchema.parse(cmd.email);
    const plain = plainPasswordSchema.parse(cmd.password);
    const now = cmd.now ?? new Date();

    const found = await this.users.findByEmail(email);

    // Anti-enumeración (doc 00 → ítem 41, US-02 AC-02/AC-03): email inexistente y contraseña
    // equivocada producen el MISMO 401 y consumen un tiempo equivalente (hash ficticio).
    const verified = await this.hasher.verify(plain, found?.passwordHash ?? null);
    if (!found || !verified) {
      this.logger.warn(LOG_EVENTS.LOGIN_FAILED, { reason: found ? LOG_REASONS.BAD_PASSWORD : LOG_REASONS.UNKNOWN_EMAIL, email });
      throw new ApiError(ErrorCodes.INVALID_CREDENTIALS);
    }

    // US-08 AC-04: cuenta solo-Google intentando login local → 401 genérico (nunca revelar colisión).
    if (found.passwordHash === null) {
      this.logger.warn(LOG_EVENTS.LOGIN_FAILED, { reason: LOG_REASONS.GOOGLE_ONLY_USER, email });
      throw new ApiError(ErrorCodes.INVALID_CREDENTIALS);
    }

    const session = await issueSession(this.tokens, this.users, {
      userId: found.id,
      provider: providerSchema.enum.local,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    this.logger.info(LOG_EVENTS.USER_LOGGED_IN, { userId: found.id, provider: providerSchema.enum.local });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id: found.id, email: found.email, createdAt: found.createdAt },
    };
  }
}