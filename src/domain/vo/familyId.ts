/** Identificador de familia de refresh — un UUID por sesión (docs/00 → ítem 38). */
import { z } from 'zod';

export const familyIdSchema = z.uuid({ message: 'invalid_family_id' });

export type FamilyId = z.infer<typeof familyIdSchema>;
