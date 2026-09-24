import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emailSchema, userIdSchema, userStatusSchema } from '../src/domain/vo/index.js';
import { newUserSchema } from '../src/domain/entity/user.js';

const id = () => userIdSchema.parse(randomUUID());
const email = (v: string) => emailSchema.parse(v);

describe('userStatusSchema (doc 04 → users.status — eje moderación, NO identidad)', () => {
  it('acepta solo los valores del vocabulario', () => {
    expect(userStatusSchema.parse('active')).toBe('active');
    expect(userStatusSchema.parse('suspended')).toBe('suspended');
    expect(userStatusSchema.parse('banned')).toBe('banned');
  });

  it('rechaza identidades/roles ajenos al eje moderación (sin kitchen-sink)', () => {
    expect(userStatusSchema.safeParse('registered').success).toBe(false);
    expect(userStatusSchema.safeParse('guest').success).toBe(false);
    expect(userStatusSchema.safeParse('user').success).toBe(false);
    expect(userStatusSchema.safeParse('admin').success).toBe(false);
    expect(userStatusSchema.safeParse('deleted').success).toBe(false);
  });
});

describe('NewUser — status default \'active\' (retrocompatibilidad, doc 04 → users.status)', () => {
  it('asigna active cuando status es omiso (todos los usuarios preexistentes)', async () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
    });
    expect(user.status).toBe('active');
  });

  it('acepta status explícito banned (solo vía SetUserModerationStatus; el schema del dominio no lo impide)', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
      status: 'banned',
    });
    expect(user.status).toBe('banned');
  });
});