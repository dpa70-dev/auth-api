/** UUID v4 de users.id (doc 00 → ítem 45) — nunca una clave autoincremental. */
import { z } from 'zod';

export const userIdSchema = z.uuid({ message: 'invalid_uuid' });

export type UserId = z.infer<typeof userIdSchema>;