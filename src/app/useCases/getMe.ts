import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import type { Logger, UserRepository } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import type { Email, UserId } from '../../domain/vo/index.js';
import type { UseCase } from '../interfaces/useCase.js';

export type GetMeCommand = {
  userId: UserId;
};

export type GetMeResult = {
  id: UserId;
  email: Email | null;
  kind: 'registered' | 'guest';
  createdAt: string;
};

/** US-05: perfil del usuario autenticado. requireAuth ya validó el access en la frontera. */
export class GetMe implements UseCase<GetMeCommand, GetMeResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: GetMeCommand): Promise<GetMeResult> {
    const user = await this.users.findById(cmd.userId);
    if (!user) throw new ApiError(ErrorCodes.UNAUTHORIZED);
    this.logger.info(LOG_EVENTS.USER_PROFILE_FETCHED, { userId: user.id });
    return { id: user.id, email: user.email, kind: user.kind, createdAt: user.createdAt };
  }
}