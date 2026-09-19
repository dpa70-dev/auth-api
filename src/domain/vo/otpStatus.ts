/**
 * Estados de un OTP (doc 00 → ítem 34). */
import { z } from 'zod';

export const otpStatusValues = ['pending', 'used', 'revoked'] as const;

export const otpStatusSchema = z.enum(otpStatusValues);

export type OtpStatus = z.infer<typeof otpStatusSchema>;
