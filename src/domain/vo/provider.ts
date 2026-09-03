/** Proveedor de identidad de una sesión (doc 04 → refresh_tokens.provider). */
import { z } from 'zod';

export const providerSchema = z.enum(['local', 'google']);

export type Provider = z.infer<typeof providerSchema>;