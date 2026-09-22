import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import { UniqueConstraintViolation } from '../../domain/uniqueConstraintViolation.js';
import type {
  CompromisedPasswordChecker,
  Logger,
  PasswordHasher,
  TokenIssuer,
  UnitOfWork,
  UserRecord,
  UserRepository,
} from '../../domain/port/index.js';
import { familyIdSchema, providerSchema, userIdSchema, userKindSchema, type Email, type PlainPassword, type UserId } from '../../domain/vo/index.js';
import { validateNewUser } from '../../domain/entity/user.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { generateSession } from '../helpers/issueSession.js';
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
  user: { id: UserId; email: Email; kind: 'registered'; createdAt: string };
};

export class RegisterUser implements UseCase<RegisterUserCommand, RegisterUserResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly compromised: CompromisedPasswordChecker,
    private readonly tokens: TokenIssuer,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: RegisterUserCommand): Promise<RegisterUserResult> {
    const now = cmd.now ?? new Date();
    const id = userIdSchema.parse(randomUUID());

    // NIST 800-63B §5.1.1.2: filtrar contraseñas comprometidas. Fail fast — antes del findByEmail,
    // para no crear cuenta ni consultar emails existentes con una contraseña que será rechazada igual.
    if ((await this.compromised.check(cmd.password)) === 'compromised') {
      this.logger.warn(LOG_EVENTS.PASSWORD_COMPROMISED_REJECTED, { email: cmd.email });
      throw new ApiError(ErrorCodes.PASSWORD_COMPROMISED, {
        details: [{ field: 'password', issue: 'compromised' }],
      });
    }

    const existing = await this.users.findByEmail(cmd.email);
    if (existing) throw collisionError(existing);

    // Crypto (argon2) FUERA de la tx (doc 13 → §13.1): llamadas lentas nunca dentro de BEGIN/COMMIT.
    const passwordHash = await this.hasher.hash(cmd.password);

    // Sesión (jose) FUERA de la tx — solo se persiste el refresh row dentro de la transacción.
    const session = await generateSession(this.tokens, {
      userId: id,
      familyId: familyIdSchema.parse(randomUUID()),
      provider: providerSchema.enum.local,
      refreshTtlDays: cmd.refreshTtlDays,
      now,
    });

    // Escrituras atómicas (doc 13 → §13.1): usuario + refresh token se crean juntos o no se crea ninguno.
    await this.unitOfWork.withTransaction(async () => {
      try {
        await this.users.createUser({
          ...validateNewUser({
            id,
            email: cmd.email,
            passwordHash,
            googleSub: null,
            emailVerified: false,
            kind: userKindSchema.enum.registered,
          }),
          createdAt: now.toISOString(),
        });
      } catch (err) {
        if (err instanceof UniqueConstraintViolation) throw collisionError(existing);
        throw err;
      }
      await this.users.insertRefreshToken(session.refreshRow);
    });

    this.logger.info(LOG_EVENTS.USER_REGISTERED, { userId: id, provider: providerSchema.enum.local });
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: { id, email: cmd.email, kind: userKindSchema.enum.registered, createdAt: now.toISOString() },
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