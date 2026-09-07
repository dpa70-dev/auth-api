/** Estados de un refresh token (doc 04 → refresh_tokens.status). */
import { z } from 'zod';

export const refreshTokenStatusValues = ['active', 'used', 'revoked'] as const;

export const refreshTokenStatusSchema = z.enum(refreshTokenStatusValues);

export type RefreshTokenStatus = z.infer<typeof refreshTokenStatusSchema>;