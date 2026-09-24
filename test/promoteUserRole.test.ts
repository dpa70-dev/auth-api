import { describe, expect, it } from 'vitest';
import { promoteUserRole } from '../scripts/promoteUserRole.js';
import type { UserRecord, UserRepository } from '../src/domain/port/index.js';
import { userSchema, type NewUser } from '../src/domain/entity/user.js';
import {
  emailSchema,
  timestampSchema,
  userIdSchema,
  userKindSchema,
  userRoleSchema,
  userStatusSchema,
  type Email,
  type GoogleSub,
  type PasswordHash,
  type Timestamp,
  type UserId,
  type UserRole,
  type UserStatus,
} from '../src/domain/vo/index.js';

// Fake en memoria del puerto UserRepository (patrón doc 09): la lógica del script NO toca SQLite,
// así que el test la ejercita con un adaptador de prueba sin migraciones ni DB temporal.
class FakeUserRepository implements UserRepository {
  private readonly rows = new Map<UserId, UserRecord>();
  roleUpdates = 0;

  seed(user: UserRecord): void {
    this.rows.set(user.id, user);
  }

  async findByEmail(email: Email): Promise<UserRecord | null> {
    for (const user of this.rows.values()) if (user.email === email) return user;
    return null;
  }

  async findByGoogleSub(_sub: GoogleSub): Promise<UserRecord | null> {
    return null;
  }

  async findById(id: UserId): Promise<UserRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async createUser(input: NewUser & { createdAt: Timestamp }): Promise<void> {
    this.rows.set(input.id, userSchema.parse({ ...input, createdAt: input.createdAt }));
  }

  async markEmailVerified(_email: Email): Promise<void> {}

  async updatePasswordHash(_userId: UserId, _passwordHash: PasswordHash): Promise<void> {}

  async upgradeGuestToRegistered(_userId: UserId, _email: Email, _passwordHash: PasswordHash): Promise<void> {}

  async setRole(userId: UserId, role: UserRole): Promise<void> {
    this.roleUpdates += 1;
    const user = this.rows.get(userId);
    if (user) this.rows.set(userId, { ...user, role });
  }

  async setModerationStatus(_userId: UserId, _status: UserStatus): Promise<void> {}
}

const USER_ID = userIdSchema.parse('00000000-0000-4000-8000-000000000001');

const makeRegisteredUser = (email: string, role: UserRole = userRoleSchema.enum.user): UserRecord =>
  userSchema.parse({
    id: USER_ID,
    email: emailSchema.parse(email),
    passwordHash: 'argon2id-hash-de-ejemplo-largo-suficiente',
    googleSub: null,
    emailVerified: true,
    kind: userKindSchema.enum.registered,
    role,
    status: userStatusSchema.enum.active,
    createdAt: timestampSchema.parse('2026-01-01T00:00:00.000Z'),
  });

describe('promoteUserRole — lógica pura del script (bootstrap del primer admin, doc 04 → users.role)', () => {
  const seedRepo = (user: UserRecord): FakeUserRepository => {
    const users = new FakeUserRepository();
    users.seed(user);
    return users;
  };

  const persistedRole = async (users: UserRepository): Promise<UserRole | null> => (await users.findById(USER_ID))?.role ?? null;

  it('promueve user → admin y persiste el cambio vía puerto', async () => {
    const users = seedRepo(makeRegisteredUser('fundador@example.com'));

    const result = await promoteUserRole(users, { email: 'fundador@example.com', role: 'admin', dryRun: false });

    expect(result).toMatchObject({ kind: 'applied', from: 'user', role: 'admin' });
    expect(users.roleUpdates).toBe(1);
    expect(await persistedRole(users)).toBe(userRoleSchema.enum.admin);
  });

  it('degradar admin → user persiste el cambio vía puerto', async () => {
    const users = seedRepo(makeRegisteredUser('ex-admin@example.com', userRoleSchema.enum.admin));

    const result = await promoteUserRole(users, { email: 'ex-admin@example.com', role: 'user', dryRun: false });

    expect(result).toMatchObject({ kind: 'applied', from: 'admin', role: 'user' });
    expect(await persistedRole(users)).toBe(userRoleSchema.enum.user);
  });

  it('ya tiene el rol → noop sin tocar el puerto', async () => {
    const users = seedRepo(makeRegisteredUser('admin@example.com', userRoleSchema.enum.admin));

    const result = await promoteUserRole(users, { email: 'admin@example.com', role: 'admin', dryRun: false });

    expect(result).toMatchObject({ kind: 'noop', role: 'admin' });
    expect(users.roleUpdates).toBe(0);
    expect(await persistedRole(users)).toBe(userRoleSchema.enum.admin);
  });

  it('dry-run reporta applied sin ejecutar el UPDATE', async () => {
    const users = seedRepo(makeRegisteredUser('fundador@example.com'));

    const result = await promoteUserRole(users, { email: 'fundador@example.com', role: 'admin', dryRun: true });

    expect(result).toMatchObject({ kind: 'applied', dryRun: true });
    expect(users.roleUpdates).toBe(0);
    expect(await persistedRole(users)).toBe(userRoleSchema.enum.user);
  });

  it('rol omitido → default admin', async () => {
    const users = seedRepo(makeRegisteredUser('fundador@example.com'));

    const result = await promoteUserRole(users, { email: 'fundador@example.com', dryRun: false });

    expect(result).toMatchObject({ kind: 'applied', role: 'admin' });
    expect(await persistedRole(users)).toBe(userRoleSchema.enum.admin);
  });

  it('usuario inexistente → not-found sin tocar el puerto', async () => {
    const users = new FakeUserRepository();

    const result = await promoteUserRole(users, { email: 'fantasma@example.com', role: 'admin', dryRun: false });

    expect(result).toMatchObject({ kind: 'not-found', email: 'fantasma@example.com' });
    expect(users.roleUpdates).toBe(0);
  });

  it('email inválido → invalid-email', async () => {
    const users = new FakeUserRepository();

    const result = await promoteUserRole(users, { email: 'no-es-email', role: 'admin', dryRun: false });

    expect(result).toMatchObject({ kind: 'invalid-email' });
    expect(users.roleUpdates).toBe(0);
  });

  it('rol inválido → invalid-role', async () => {
    const users = seedRepo(makeRegisteredUser('fundador@example.com'));

    const result = await promoteUserRole(users, { email: 'fundador@example.com', role: 'superadmin', dryRun: false });

    expect(result).toMatchObject({ kind: 'invalid-role' });
    expect(users.roleUpdates).toBe(0);
  });
});