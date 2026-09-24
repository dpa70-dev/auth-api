import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { emailSchema, userRoleSchema, userIdSchema } from '../src/domain/vo/index.js';
import { newUserSchema } from '../src/domain/entity/user.js';

const id = () => userIdSchema.parse(randomUUID());
const email = (v: string) => emailSchema.parse(v);

describe('userRoleSchema (doc 04 → users.role — eje autorización, NO identidad)', () => {
  it('acepta solo los valores del vocabulario', () => {
    expect(userRoleSchema.parse('user')).toBe('user');
    expect(userRoleSchema.parse('admin')).toBe('admin');
  });

  it('rechaza identidades/estados ajenos al eje autorización (sin kitchen-sink)', () => {
    expect(userRoleSchema.safeParse('registered').success).toBe(false);
    expect(userRoleSchema.safeParse('guest').success).toBe(false);
    expect(userRoleSchema.safeParse('superadmin').success).toBe(false);
    expect(userRoleSchema.safeParse('suspended').success).toBe(false);
  });
});

describe('NewUser — role default \'user\' (retrocompatibilidad, doc 04 → users.role)', () => {
  it('asigna user cuando role es omiso (todos los usuarios preexistentes)', async () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
    });
    expect(user.role).toBe('user');
  });

  it('acepta role explícito admin (solo vía SetUserRole; el schema del dominio no lo impide)', () => {
    const user = newUserSchema.parse({
      id: id(),
      email: email('ana@example.com'),
      passwordHash: 'argon2id-hash-ejemplo',
      googleSub: null,
      emailVerified: false,
      role: 'admin',
    });
    expect(user.role).toBe('admin');
  });
});