import type { RequestHandler } from 'express';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import { userIdSchema } from '../../domain/vo/index.js';
import type { UseCases } from '../../app/buildUseCases.js';
import { writeSuccess } from '../protocol/success.js';
import { setUserRoleRequest } from './schemas.js';

/** Handler del endpoint admin (doc 04 → users.role): PATCH /admin/users/:id/role → 204 sin body. */
export const buildAdminHandlers = (useCases: UseCases) => {
  const setUserRoleHandler: RequestHandler = async (req, res, next) => {
    try {
      // requireAuth + requireRole garantizan admin; defensa extra del contrato (nunca `!`).
      const actorId = req.userId;
      if (!actorId) throw new ApiError(ErrorCodes.UNAUTHORIZED);
      const targetId = userIdSchema.parse(req.params.id);
      const { role } = setUserRoleRequest.parse(req.body);
      await useCases.setUserRole.execute({ actorId, targetId, role });
      writeSuccess(res, 204, null);
    } catch (err) {
      next(err);
    }
  };

  return { setUserRoleHandler };
};