import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';
import { emailSchema, userRoleSchema, type Email, type UserRole } from '../src/domain/vo/index.js';

// Default idéntico al de config.ts (DB_PATH) — este script NO valida todo el env porque
// la promoción de rol no necesita el resto de la configuración (Solo aplica un UPDATE).
const DB_PATH_DEFAULT = 'data/app.sqlite';

const ARGS_USAGE = `Uso: npm run promote:admin -- --email=<email> [--role=admin|user] [--db-path=<ruta>] [--dry-run]

Promueve o degrada el rol de UN usuario existente (fuera del contrato HTTP — operación
de operador para el bootstrap del primer admin; luego PATCH /admin/users/{id}/role
gestiona el resto).

  --email=<email>   Email del usuario objetivo (obligatorio; normalizado igual que la API).
  --role=<rol>      'admin' (default) o 'user'. Al degradar a 'user', el usuario deja de
                    usar /admin/* en el siguiente request (el rol viaja en DB, no en el token).
  --db-path=<ruta>  Ruta al SQLite. Default: $DB_PATH si está seteado, si no 'data/app.sqlite'.
  --dry-run         Muestra el cambio sin aplicarlo (no ejecuta el UPDATE).

El usuario objetivo DEBE existir (el fundador se auto-registra con rol 'user' y luego
este script lo promueve). No toca sessions: el rol no invalida tokens.`;

const readArg = (key: string): string | undefined => {
  const eq = process.argv.slice(2).find((a) => a.startsWith(`${key}=`));
  if (eq) return eq.slice(key.length + 1);
  const i = process.argv.slice(2).indexOf(key);
  return i !== -1 ? process.argv.slice(2)[i + 1] : undefined;
};

const main = async (): Promise<void> => {
  const emailRaw = readArg('--email');
  const roleRaw = readArg('--role') ?? 'admin';
  const dbPath = readArg('--db-path') ?? process.env.DB_PATH ?? DB_PATH_DEFAULT;
  const dryRun = process.argv.slice(2).includes('--dry-run');

  if (!emailRaw) {
    process.stdout.write(`${ARGS_USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const parsedEmail = emailSchema.safeParse(emailRaw);
  if (!parsedEmail.success) {
    process.stdout.write(`Email inválido: ${emailRaw}\n`);
    process.exitCode = 1;
    return;
  }
  const email: Email = parsedEmail.data;

  const parsedRole = userRoleSchema.safeParse(roleRaw);
  if (!parsedRole.success) {
    process.stdout.write(`Rol inválido: ${roleRaw} (esperado 'admin' o 'user')\n`);
    process.exitCode = 1;
    return;
  }
  const role: UserRole = parsedRole.data;

  // Mismo setup que composeInfra: pragma FK + migraciones, para operar sobre una DB real
  // (incluso si aún nunca arrancó la app — el script la deja migrada y consistente).
  const sqlite = new Database(dbPath, { fileMustExist: false });
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './migrations' });
  const users = new DrizzleUserRepository(db);

  try {
    const found = await users.findByEmail(email);
    if (!found) {
      process.stdout.write(`Usuario no encontrado: ${email} — el fundador debe registrarse antes (los usuarios nacen con rol 'user')\n`);
      process.exitCode = 1;
      return;
    }

    if (found.role === role) {
      process.stdout.write(`Sin cambios: ${email} ya tiene rol '${role}' (id ${found.id})\n`);
      return;
    }

    process.stdout.write(`${dryRun ? '[dry-run] Se aplicaría: ' : 'Aplicando: '}${found.role} → ${role} para ${email} (id ${found.id})\n`);
    if (dryRun) return;

    await users.setRole(found.id, role);
    process.stdout.write(`Hecho: ${email} ahora tiene rol '${role}'\n`);
  } finally {
    sqlite.close();
  }
};

main().catch((err: unknown) => {
  console.error(String(err));
  process.exitCode = 1;
});