import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DrizzleUserRepository } from '../src/infra/db/drizzleUserRepository.js';
import { promoteUserRole, type PromoteUserRoleResult } from './promoteUserRole.js';

// Default idéntico al de config.ts (DB_PATH) — este runner NO valida todo el env porque
// la promoción de rol no necesita el resto de la configuración (solo aplica un UPDATE).
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
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`${key}=`));
  if (eq) return eq.slice(key.length + 1);
  const i = argv.indexOf(key);
  return i !== -1 ? argv[i + 1] : undefined;
};

const printResult = (result: PromoteUserRoleResult): void => {
  switch (result.kind) {
    case 'invalid-email':
      process.stdout.write(`Email inválido: ${result.email}\n`);
      process.exitCode = 1;
      return;
    case 'invalid-role':
      process.stdout.write(`Rol inválido: ${result.role} (esperado 'admin' o 'user')\n`);
      process.exitCode = 1;
      return;
    case 'not-found':
      process.stdout.write(`Usuario no encontrado: ${result.email} — el fundador debe registrarse antes (los usuarios nacen con rol 'user')\n`);
      process.exitCode = 1;
      return;
    case 'noop':
      process.stdout.write(`Sin cambios: ${result.email} ya tiene rol '${result.role}' (id ${result.userId})\n`);
      return;
    case 'applied':
      process.stdout.write(`${result.dryRun ? '[dry-run] Se aplicaría: ' : 'Aplicando: '}${result.from} → ${result.role} para ${result.email} (id ${result.userId})\n`);
      if (!result.dryRun) process.stdout.write(`Hecho: ${result.email} ahora tiene rol '${result.role}'\n`);
      return;
  }
};

const main = async (): Promise<void> => {
  const email = readArg('--email');
  if (!email) {
    process.stdout.write(`${ARGS_USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const role = readArg('--role');
  const dbPath = readArg('--db-path') ?? process.env.DB_PATH ?? DB_PATH_DEFAULT;
  const dryRun = process.argv.slice(2).includes('--dry-run');

  // Composition root del runner: único punto que conoce el adaptador concreto. Mismo setup que
  // composeInfra (pragma FK + migrate) para operar sobre una DB real, incluso sin haber arrancado.
  const sqlite = new Database(dbPath, { fileMustExist: false });
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './migrations' });
  const users = new DrizzleUserRepository(db);

  // exactOptionalPropertyTypes: role no debe pasar undefined explícito — se omite si no viene.
  const input = { email, dryRun, ...(role !== undefined ? { role } : {}) };

  try {
    printResult(await promoteUserRole(users, input));
  } finally {
    sqlite.close();
  }
};

main().catch((err: unknown) => {
  console.error(String(err));
  process.exitCode = 1;
});