/**
 * Código OTP de 6 dígitos (doc 00 → ítem 34). El VO representa el código plano que el usuario escribe (nunca el hash).
 * Solo los strings '000000'..'999999' son válidos (rechaza 5 o 7 dígitos, rechaza no numérico, rechaza vacío).
 */
import { z } from 'zod';

export const otpCodeSchema = z
  .string({ message: 'otp_code debe ser un string' })
  .length(6, { message: 'otp_code_debe_ser_exactamente_6_digitos' })
  .regex(/^[0-9]{6}$/, { message: 'otp_code_debe_ser_numerico' });

export type OtpCode = z.infer<typeof otpCodeSchema>;
