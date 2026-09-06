/** Propósito de un magic link (doc 04 → magic_links.purpose): acceso (login) o reset de contraseña. */
import { z } from 'zod';

export const magicLinkPurposeSchema = z.enum(['login', 'password_reset']);

export type MagicLinkPurpose = z.infer<typeof magicLinkPurposeSchema>;