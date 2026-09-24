import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import type { UserId, UserRole } from '../../domain/vo/index.js';
import type { UseCase } from '../interfaces/useCase.js';

export type SetUserRoleCommand = {
  /** Actor autenticado (del access token, NUNCA del body — trust boundary). */
  actorId: UserId;
  targetId: UserId;
  role: UserRole;
};

/**
 * Asigna el rol (user/admin) en el eje de autorización (doc 04 → users.role).
 * Solo un admin promueve/degrada; nadie puede tocarse a sí mismo (evita que el
 * último admin se degrade y deje el sistema sin admins).
 */
export class SetUserRole implements UseCase<SetUserRoleCommand, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: SetUserRoleCommand): Promise<void> {
    const actor = await this.users.findById(cmd.actorId);
    // Guard defensivo: requireRole garantizó el acceso; si el actor desapareció, 401 genérico.
    if (!actor) throw new ApiError(ErrorCodes.UNAUTHORIZED);
    if (actor.role !== 'admin') throw new ApiError(ErrorCodes.FORBIDDEN);
    if (cmd.actorId === cmd.targetId) throw new ApiError(ErrorCodes.FORBIDDEN);

    const target = await this.users.findById(cmd.targetId);
    if (!target) throw new ApiError(ErrorCodes.NOT_FOUND);

    await this.users.setRole(cmd.targetId, cmd.role);
    this.logger.info(LOG_EVENTS.USER_ROLE_CHANGED, { actorId: cmd.actorId, targetId: cmd.targetId, role: cmd.role });
  }
}