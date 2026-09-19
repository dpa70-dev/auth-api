/**
 * Tipo de cuenta (doc 04 → users.kind): discriminador del eje IDENTIDAD, NO rol ni estado.
 * `registered` = ligada a una identidad real · `guest` = anónima temporal upgradable.
 */
import { z } from 'zod';

export const userKindValues = ['registered', 'guest'] as const;

export const userKindSchema = z.enum(userKindValues);

export type UserKind = z.infer<typeof userKindSchema>;