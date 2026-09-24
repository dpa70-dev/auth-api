import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, RefreshTokenRepository, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import type { UserId, UserStatus } from '../../domain/vo/index.js';
import type { UseCase } from '../interfaces/useCase.js';

export type SetUserModerationStatusCommand = {
  /** Actor autenticado (del access token, NUNCA del body — trust boundary). */
  actorId: UserId;
  targetId: UserId;
  status: UserStatus;
};

export type SetUserModerationStatusResult = {
  id: UserId;
  status: UserStatus;
};

/**
 * Asigna el estado de moderación (doc 04 → users.status). Solo un admin modera;
 * transiciones libres (cualquier → cualquier: un-ban es decisión administrativa legítima).
 * Al pasar a suspended/banned se revocan TODAS las sesiones del target (patrón F1):
 * el access token muere en su TTL corto y el refresh ya no sirve — volver a active
 * NO re-emite sesiones, el usuario re-autentica.
 */
export class SetUserModerationStatus implements UseCase<SetUserModerationStatusCommand, SetUserModerationStatusResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: SetUserModerationStatusCommand): Promise<SetUserModerationStatusResult> {
    const actor = await this.users.findById(cmd.actorId);
    // Guard defensivo: requireRole garantizó el acceso; si el actor desapareció, 401 genérico.
    if (!actor) throw new ApiError(ErrorCodes.UNAUTHORIZED);
    if (actor.role !== 'admin') throw new ApiError(ErrorCodes.FORBIDDEN);

    const target = await this.users.findById(cmd.targetId);
    if (!target) throw new ApiError(ErrorCodes.NOT_FOUND);

    await this.users.setModerationStatus(cmd.targetId, cmd.status);
    if (cmd.status !== 'active') {
      await this.refreshTokens.revokeAllForUser(cmd.targetId);
    }
    this.logger.info(LOG_EVENTS.USER_STATUS_CHANGED, { actorId: cmd.actorId, targetId: cmd.targetId, status: cmd.status });
    return { id: cmd.targetId, status: cmd.status };
  }
}