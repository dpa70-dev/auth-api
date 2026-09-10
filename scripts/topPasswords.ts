import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const SOURCES: readonly { url: string; name: string }[] = [
  {
    name: 'top-100k global (inglés)',
    url: 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/Pwdb_top-100000.txt',
  },
  {
    name: 'top-150 español',
    url: 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/Language-Specific/Spanish_Pwdb_common-password-list-top-150.txt',
  },
];
const OUT_PATH = 'data/top-100k-sha1.txt';

const sha1Upper = (s: string): string => createHash('sha1').update(s).digest('hex').toUpperCase();

/** Descarga una fuente y devuelve sus hashes SHA-1 en mayúsculas (líneas no vacías, trim de CRLF). */
const fetchHashes = async (source: { url: string; name: string }): Promise<Set<string>> => {
  process.stdout.write(`Descargando ${source.name}...\n`);
  const res = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`Descarga fallida (${source.name}): HTTP ${res.status} ${res.statusText}`);
  }
  const lines = (await res.text()).split('\n');
  // Línea vacía o con \r de CRLF: descartar ANTES de hashear (el hash del string vacío es válido).
  return new Set(lines.map((l) => l.trim()).filter((l) => l.length > 0).map(sha1Upper));
};

/**
 * Genera data/top-100k-sha1.txt: hashes SHA-1 en mayúsculas (uno por línea) del top-100k global
 * de SecLists más el top-150 español, deduplicados — el formato exacto que espera
 * LocalCompromisedPasswordChecker para el tier 2.
 * Uso: npm run gen:password-list
 */
const main = async (): Promise<void> => {
  const all = new Set<string>();
  for (const source of SOURCES) {
    const hashes = await fetchHashes(source);
    for (const h of hashes) all.add(h);
  }
  mkdirSync('data', { recursive: true });
  writeFileSync(OUT_PATH, `${[...all].join('\n')}\n`, 'utf8');
  process.stdout.write(`Escritos ${all.size} hashes en ${OUT_PATH}\n`);
};

main().catch((err: unknown) => {
  console.error(String(err));
  process.exitCode = 1;
});