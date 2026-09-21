import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { BreachCheckResult, CompromisedPasswordChecker, Logger } from '../../domain/port/index.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import type { PlainPassword } from '../../domain/vo/index.js';
import { WEAK_PASSWORDS } from './weakPasswords.js';

const sha1Upper = (s: string): string => createHash('sha1').update(s).digest('hex').toUpperCase();

/** Línea válida del archivo de top-100k: hash SHA-1 en mayúsculas, sin contador. */
const HASH_LINE = /^[0-9A-F]{40}$/;

/** Secuencias para la regla de patrones (adelante Y atrás): digits, alfabeto, filas del teclado. */
const SEQUENCES: readonly string[] = [
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

/** Todos los 4-gramas prohibidos (secuencia hacia adelante y hacia atrás), precomputados una vez. */
const buildBanned4Grams = (): Set<string> => {
  const grams = new Set<string>();
  for (const seq of SEQUENCES) {
    for (let i = 0; i <= seq.length - 4; i++) grams.add(seq.slice(i, i + 4));
    const reversed = [...seq].reverse().join('');
    for (let i = 0; i <= reversed.length - 4; i++) grams.add(reversed.slice(i, i + 4));
  }
  return grams;
};

/**
 * Fallback local (NIST 800-63B §5.1.1.2): nunca reporta 'unavailable' — siempre puede responder.
 * Fuentes en orden: top-100 embebida → archivo de hashes top-100k (opcional) → reglas algorítmicas
 * (caracteres repetidos, secuencias y filas de teclado). El archivo se genera con scripts/topPasswords.ts.
 */
export class LocalCompromisedPasswordChecker implements CompromisedPasswordChecker {
  private readonly embeddedHashes: Set<string>;
  private readonly topListHashes = new Set<string>();
  private readonly banned4Grams: Set<string> = buildBanned4Grams();
  private readonly repeatedRun = /(.)\1{3,}/;
  private readonly listLoaded: boolean;

  constructor(
    private readonly logger: Logger,
    listPath?: string,
  ) {
    // La lista embebida se hashea UNA vez al construir: el runtime nunca guarda texto en claro.
    this.embeddedHashes = new Set(WEAK_PASSWORDS.map((p) => sha1Upper(p)));

    this.listLoaded = listPath !== undefined && existsSync(listPath);
    if (listPath !== undefined && this.listLoaded) {
      try {
        for (const line of readFileSync(listPath, 'utf8').split('\n')) {
          const hash = line.trim();
          if (HASH_LINE.test(hash)) this.topListHashes.add(hash);
        }
      } catch (err) {
        this.logger.error(LOG_EVENTS.PASSWORD_BREACH_CHECK_FAILED, {
          reason: `local password list unreadable: ${listPath} (${String(err)})`,
        });
      }
    } else if (listPath !== undefined) {
      this.logger.warn(LOG_EVENTS.PASSWORD_BREACH_CHECK_FAILED, {
        reason: `local password list not found: ${listPath} — fallback reducido a lista embebida + patrones`,
      });
    }
  }

  async check(password: PlainPassword): Promise<BreachCheckResult> {
    const hash = sha1Upper(password);
    if (this.embeddedHashes.has(hash)) return 'compromised';
    if (this.listLoaded && this.topListHashes.has(hash)) return 'compromised';

    // NIST §5.1.1.2: repetitivo o secuencial-only. 4+ caracteres iguales o un 4-grama de secuencia/teclado.
    if (this.repeatedRun.test(password)) return 'compromised';
    const lower = password.toLowerCase();
    for (const gram of this.banned4Grams) {
      if (lower.includes(gram)) return 'compromised';
    }
    return 'clean';
  }
}