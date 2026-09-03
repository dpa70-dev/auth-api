/** Identificador del refresh token (doc 00 → ítem 38, columna refresh_tokens.jti). */
import { z } from 'zod';

export const jtiSchema = z.uuid({ message: 'invalid_jti' });

export type Jti = z.infer<typeof jtiSchema>;