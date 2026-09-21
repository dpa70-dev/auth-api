import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { LocalCompromisedPasswordChecker } from '../src/infra/compromised/localCompromisedPasswordChecker.js';
import type { Logger } from '../src/domain/port/index.js';
import type { PlainPassword } from '../src/domain/vo/index.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

const sha1Upper = (s: string): string => createHash('sha1').update(s).digest('hex').toUpperCase();

/** Archivo temporal con hashes SHA-1 (formato del tier 2); el directorio se borra en afterEach. */
const tempDirs: string[] = [];
const tempList = (...hashes: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'top-passwords-test-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'list.txt'), `${hashes.join('\n')}\n`, 'utf8');
  return join(dir, 'list.txt');
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const pw = (s: string): PlainPassword => s as PlainPassword;

describe('LocalCompromisedPasswordChecker — fallback NIST (tier embebida → archivo → patrones)', () => {
  it('siempre responde clean o compromised: nunca unavailable (el origen local está disponible)', async () => {
    const checker = new LocalCompromisedPasswordChecker(silentLogger);
    const result = await checker.check(pw('q9zK2xL7mP4v'));
    expect(['clean', 'compromised']).toContain(result);
  });

  it('tier 1 — top-100 embebida: marca como comprometida una contraseña de la lista', async () => {
    const checker = new LocalCompromisedPasswordChecker(silentLogger);
    await expect(checker.check(pw('password'))).resolves.toBe('compromised');
    await expect(checker.check(pw('123456'))).resolves.toBe('compromised');
  });

  it('tier 2 — archivo de hashes: detecta la contraseña solo si su SHA-1 está en el archivo', async () => {
    const listPath = tempList(sha1Upper('contraseñaArchivo123'), 'basura-no-hash');
    const checker = new LocalCompromisedPasswordChecker(silentLogger, listPath);

    await expect(checker.check(pw('contraseñaArchivo123'))).resolves.toBe('compromised');
    await expect(checker.check(pw('contraseñaFueraDeLista123'))).resolves.toBe('clean');
  });

  it('tier 3 — caracteres repetidos (4+): comprometida', async () => {
    const checker = new LocalCompromisedPasswordChecker(silentLogger);
    await expect(checker.check(pw('aaaa'))).resolves.toBe('compromised');
  });

  it('tier 3 — secuencias/teclado (4-gramas): comprometida; sin el 4-grama, limpia', async () => {
    const checker = new LocalCompromisedPasswordChecker(silentLogger);
    await expect(checker.check(pw('abcde'))).resolves.toBe('compromised'); // abcde → grama 'abcd'
    await expect(checker.check(pw('qwer1234'))).resolves.toBe('compromised'); // fila teclado + digits
    await expect(checker.check(pw('q9zK2xL7mP4v'))).resolves.toBe('clean');
  });

  it('sin archivo configurado, el tier 2 se omite y solo aplican embebida + patrones', async () => {
    const checker = new LocalCompromisedPasswordChecker(silentLogger, '/ruta/que/no/existe.txt');
    await expect(checker.check(pw('password'))).resolves.toBe('compromised');
    await expect(checker.check(pw('q9zK2xL7mP4v'))).resolves.toBe('clean');
  });
});