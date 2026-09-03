/** Estados de un refresh token (doc 04 → refresh_tokens.status). */
import { z } from 'zod';

export const refreshTokenStatusSchema = z.enum(['active', 'used', 'revoked']);

export type RefreshTokenStatus = z.infer<typeof refreshTokenStatusSchema>;