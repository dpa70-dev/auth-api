/** Estados de un magic link (doc 04 → magic_links.status). */
import { z } from 'zod';

export const magicLinkStatusSchema = z.enum(['pending', 'used', 'revoked']);

export type MagicLinkStatus = z.infer<typeof magicLinkStatusSchema>;
