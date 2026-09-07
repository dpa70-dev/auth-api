/** Estados de un magic link (doc 04 → magic_links.status). */
import { z } from 'zod';

export const magicLinkStatusValues = ['pending', 'used', 'revoked'] as const;

export const magicLinkStatusSchema = z.enum(magicLinkStatusValues);

export type MagicLinkStatus = z.infer<typeof magicLinkStatusSchema>;
