import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import { UniqueConstraintViolation } from '../../domain/uniqueConstraintViolation.js';
import type { Logger, PasswordHasher, TokenIssuer, UserRecord, UserRepository } from '../../domain/port/index.js';
import { providerSchema, userIdSchema, type Email, type PlainPassword, type UserId } from '../../domain/vo/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { issueSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

export type RegisterUserCommand = {
  email: Email;
  password: PlainPassword;
  refreshTtlDays: number;
  now?: Date;
};

export type RegisterUserResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email; createdAt: string };
};

export class RegisterUser implements UseCase<RegisterUserCommand, RegisterUserResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: RegisterUserCommand): Promise<RegisterUserResult> {
    const now = cmd.now ?? new Date();
    const id = userIdSchema.parse(randomUUID());

    const existing = await this.users.findByEmail(cmd.email);
    if (existing) throw collisionError(existing);

    const passwordHash = await this.hasher.hash(cmd.password);
    try {
      await this.users.createUser({
        id,
        email: cmd.email,
        passwordHash,
        googleSub: null,
        emailVerified: false,
        createdAt: now.toISOString(),
      });
    } catch (err) {
      if (err instanceof UniqueConstraintViolation) throw collisionError(existing);
      throw err;
    }

    const session = await issueSession(this.tokens, this.users, {
      userId: id,
      provider: providerSchema.enum.local,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    this.logger.info(LOG_EVENTS.USER_REGISTERED, { userId: id, provider: providerSchema.enum.local });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id, email: cmd.email, createdAt: now.toISOString() },
    };
  }
}

/** US-08 AC-01/AC-05: solo-Google → sugerir Google; local → email ya existe. Sin auto-linking. */
const collisionError = (existing: UserRecord | null): ApiError => {
  if (existing && existing.passwordHash === null) {
    return new ApiError(ErrorCodes.ACCOUNT_EXISTS_WITH_GOOGLE, {
      details: [{ field: 'provider', issue: providerSchema.enum.google }],
    });
  }
  return new ApiError(ErrorCodes.EMAIL_ALREADY_EXISTS, {
    details: [{ field: 'provider', issue: providerSchema.enum.local }],
  });
};