import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emailSchema, userKindSchema, userIdSchema } from '../src/domain/vo/index.js';
import { newUserSchema } from '../src/domain/entity/user.js';

const id = () => userIdSchema.parse(randomUUID());
const email = (v: string) => emailSchema.parse(v);

describe('userKindSchema (doc 04 → users.kind — eje identidad, NO rol)', () => {
  it('acepta solo los valores del vocabulario', () => {
    expect(userKindSchema.parse('registered')).toBe('registered');
    expect(userKindSchema.parse('guest')).toBe('guest');
  });

  it('rechaza roles/estados ajenos al eje identidad (sin kitchen-sink)', () => {
    expect(userKindSchema.safeParse('admin').success).toBe(false);
    expect(userKindSchema.safeParse('suspended').success).toBe(false);
    expect(userKindSchema.safeParse('active').success).toBe(false);
  });
});

describe('NewUser — kind guest (US-15: cuenta anónima sin identidad)', () => {
  it('acepta guest sin email, sin password y sin google_sub', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: null,
      passwordHash: null,
      googleSub: null,
      emailVerified: false,
      kind: 'guest',
    });
    expect(user.kind).toBe('guest');
    expect(user.email).toBeNull();
  });

  it('acepta guest con email presente (no lo exige, pero no lo prohíbe)', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: null,
      googleSub: null,
      emailVerified: false,
      kind: 'guest',
    });
    expect(user.kind).toBe('guest');
    expect(user.email).toBe(email('ana@example.com'));
  });
});

describe('NewUser — kind registered exige identidad (refine, espejo del CHECK de users)', () => {
  it('acepta registered con email + password_hash', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
      kind: 'registered',
    });
    expect(user.kind).toBe('registered');
  });

  it('acepta registered con email + google_sub', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: null,
      googleSub: 'google-sub-123',
      emailVerified: true,
      kind: 'registered',
    });
    expect(user.kind).toBe('registered');
  });

  it('rechaza registered sin email (guest es el único tipo sin identidad)', () => {
    const result = newUserSchema.safeParse({
      id: id(),
      email: null,
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
      kind: 'registered',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza registered sin ninguna identidad (password/google_sub/email_verified)', () => {
    const result = newUserSchema.safeParse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: null,
      googleSub: null,
      emailVerified: false,
      kind: 'registered',
    });
    expect(result.success).toBe(false);
  });
});

describe(`NewUser — kind default 'registered' (retrocompatibilidad, doc 04 → users.kind)`, () => {
  it('asigna registered cuando kind es omiso (todos los usuarios preexistentes)', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
    });
    expect(user.kind).toBe('registered');
  });
});