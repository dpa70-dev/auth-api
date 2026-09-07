/** Propósito de un magic link (doc 04 → magic_links.purpose): acceso (login) o reset de contraseña. */
import { z } from 'zod';

export const magicLinkPurposeValues = ['login', 'password_reset'] as const;

export const magicLinkPurposeSchema = z.enum(magicLinkPurposeValues);

export type MagicLinkPurpose = z.infer<typeof magicLinkPurposeSchema>;