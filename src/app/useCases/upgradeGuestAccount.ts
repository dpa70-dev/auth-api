import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import { UniqueConstraintViolation } from '../../domain/uniqueConstraintViolation.js';
import type {
  CompromisedPasswordChecker,
  Logger,
  PasswordHasher,
  UnitOfWork,
  UserRepository,
} from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { userKindSchema, type Email, type PlainPassword, type Timestamp, type UserId } from '../../domain/vo/index.js';
import type { UseCase } from '../interfaces/useCase.js';

export type UpgradeGuestAccountCommand = {
  userId: UserId;
  email: Email;
  password: PlainPassword;
};

export type UpgradeGuestAccountResult = {
  id: UserId;
  email: Email;
  kind: 'registered';
  createdAt: Timestamp;
};

/**
 * US-16: reclama identidad (email+password) sobre una cuenta guest (US-15).
 *
 * Diferencia clave contra change-password/reset (decidida con el usuario en el plan):
 * este use case **NO revoca sesiones** — el guest conserva su sesión actual y los tokens
 * siguen sirviendo; el upgrade es sobre la MISMA cuenta, no una conmutación de identidad.
 * email_verified queda false → se verifica después vía magic link (mismo flujo que registro).
 */
export class UpgradeGuestAccount implements UseCase<UpgradeGuestAccountCommand, UpgradeGuestAccountResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly compromised: CompromisedPasswordChecker,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: UpgradeGuestAccountCommand): Promise<UpgradeGuestAccountResult> {
    // Guard defensivo: requireAuth garantizó la existencia en la frontera; si la cuenta
    // desapareció entre el token y esta consulta, 401 genérico (mismo patrón changePassword).
    const user = await this.users.findById(cmd.userId);
    if (!user) throw new ApiError(ErrorCodes.UNAUTHORIZED);

    // Solo se puede reclamar una cuenta guest; local/Google/OTP ya tienen identidad → 409.
    if (user.kind !== userKindSchema.enum.guest) {
      throw new ApiError(ErrorCodes.GUEST_UPGRADE_INVALID, {
        details: [{ field: 'kind', issue: userKindSchema.enum.registered }],
      });
    }

    // NIST 800-63B §5.1.1.2: filtrar comprometidas antes de tocar datos (fail fast, patrón registerUser).
    if ((await this.compromised.check(cmd.password)) === 'compromised') {
      this.logger.warn(LOG_EVENTS.PASSWORD_COMPROMISED_REJECTED, { userId: user.id });
      throw new ApiError(ErrorCodes.PASSWORD_COMPROMISED, {
        details: [{ field: 'password', issue: 'compromised' }],
      });
    }

    // Unicidad de email: otra cuenta con ese email → 409 (patrón registerUser.ts:55). Sin auto-linking.
    const existing = await this.users.findByEmail(cmd.email);
    if (existing) {
      throw new ApiError(ErrorCodes.EMAIL_ALREADY_EXISTS, {
        details: [{ field: 'email', issue: 'already_in_use' }],
      });
    }

    // Crypto (argon2) FUERA de la tx (doc 13 → §13.1): llamadas lentas nunca dentro de BEGIN/COMMIT.
    const passwordHash = await this.hasher.hash(cmd.password);

    // Escritura atómica US-16: email + password_hash + kind='registered'. email_verified NO se toca.
    try {
      await this.unitOfWork.withTransaction(async () => {
        await this.users.upgradeGuestToRegistered(user.id, cmd.email, passwordHash);
      });
    } catch (err) {
      // Carrera de unicidad (email tomado entre el findByEmail y el UPDATE): mismo 409.
      if (err instanceof UniqueConstraintViolation) {
        throw new ApiError(ErrorCodes.EMAIL_ALREADY_EXISTS, {
          details: [{ field: 'email', issue: 'already_in_use' }],
        });
      }
      throw err;
    }

    this.logger.info(LOG_EVENTS.GUEST_UPGRADED, { userId: user.id });
    return { id: user.id, email: cmd.email, kind: userKindSchema.enum.registered, createdAt: user.createdAt };
  }
}