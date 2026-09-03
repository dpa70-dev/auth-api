/** Timestamp ISO 8601 UTC (doc 00 → ítem 15). */
import { z } from 'zod';

export const timestampSchema = z.iso.datetime({ message: 'invalid_timestamp' });

export type Timestamp = z.infer<typeof timestampSchema>;