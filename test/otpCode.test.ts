import { describe, expect, it } from 'vitest';
import { otpCodeSchema, otpStatusSchema } from '../src/domain/vo/index.js';

describe('otpCodeSchema (doc 00 → ítem 34)', () => {
  it('acepta códigos de exactamente 6 dígitos numéricos', () => {
    expect(otpCodeSchema.parse('123456')).toBe('123456');
    expect(otpCodeSchema.parse('000000')).toBe('000000');
    expect(otpCodeSchema.parse('999999')).toBe('999999');
  });

  it('rechaza 5 dígitos', () => {
    expect(otpCodeSchema.safeParse('12345').success).toBe(false);
  });

  it('rechaza 7 dígitos', () => {
    expect(otpCodeSchema.safeParse('1234567').success).toBe(false);
  });

  it('rechaza caracteres no numéricos', () => {
    expect(otpCodeSchema.safeParse('12a456').success).toBe(false);
    expect(otpCodeSchema.safeParse('abcdef').success).toBe(false);
  });

  it('rechaza vacío', () => {
    expect(otpCodeSchema.safeParse('').success).toBe(false);
  });
});

describe('otpStatusSchema', () => {
  it('acepta solo los estados del vocabulario', () => {
    expect(otpStatusSchema.parse('pending')).toBe('pending');
    expect(otpStatusSchema.parse('used')).toBe('used');
    expect(otpStatusSchema.parse('revoked')).toBe('revoked');
  });

  it('rechaza estados ajenos', () => {
    expect(otpStatusSchema.safeParse('expired').success).toBe(false);
  });
});