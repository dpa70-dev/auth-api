/** Proveedor de identidad de una sesión (doc 04 → refresh_tokens.provider). */
import { z } from 'zod';

export const providerValues = ['local', 'google', 'magic'] as const;

export const providerSchema = z.enum(providerValues);

export type Provider = z.infer<typeof providerSchema>;