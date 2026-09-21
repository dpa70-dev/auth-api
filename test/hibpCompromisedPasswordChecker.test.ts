import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { HibpCompromisedPasswordChecker } from '../src/infra/compromised/hibpCompromisedPasswordChecker.js';
import { LOG_EVENTS } from '../src/domain/port/index.js';
import type { Logger } from '../src/domain/port/index.js';
import type { PlainPassword } from '../src/domain/vo/index.js';

const silentLogger = (overrides: Partial<Logger> = {}): Logger => ({ info() {}, warn() {}, error() {}, ...overrides });

/** Genera el cuerpo HIBP que declara comprometida una contraseña (sufijo en mayúsculas:contador). */
const compromisedBody = (password: string): string => {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  return `${sha1.slice(5)}:123\n` + '000000000000000000000000000000000000000D:1\n';
};

const fetchReturning = (text: string): typeof fetch =>
  vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', text: async () => text })) as unknown as typeof fetch;

const pw = (s: string): PlainPassword => s as PlainPassword;

describe('HibpCompromisedPasswordChecker — k-anonymity HIBP (tri-state)', () => {
  it('compromised cuando el sufijo SHA-1 aparece en la respuesta del rango', async () => {
    const password = pw('contraseñaFiltrada123');
    const fetchFn = fetchReturning(compromisedBody(password));
    const checker = new HibpCompromisedPasswordChecker(silentLogger(), fetchFn);

    await expect(checker.check(password)).resolves.toBe('compromised');
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`,
      expect.objectContaining({ headers: { 'Add-Padding': 'true' } }),
    );
  });

  it('clean cuando el sufijo no está en la respuesta (contraseña limpia)', async () => {
    const password = pw('contraseñaLimpia123');
    const checker = new HibpCompromisedPasswordChecker(silentLogger(), fetchReturning('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:42\n'));

    await expect(checker.check(password)).resolves.toBe('clean');
  });

  it('unavailable y log de error cuando fetch lanza (el fail-open lo decide el composite)', async () => {
    const errorSpy = vi.fn();
    const fetchFn = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const checker = new HibpCompromisedPasswordChecker(silentLogger({ error: errorSpy }), fetchFn);

    await expect(checker.check(pw('cualquieraSegura123'))).resolves.toBe('unavailable');
    expect(errorSpy).toHaveBeenCalledWith(LOG_EVENTS.PASSWORD_BREACH_CHECK_FAILED, expect.objectContaining({ reason: expect.stringContaining('ECONNRESET') }));
  });

  it('unavailable y log de error cuando la API responde no-OK (el fail-open lo decide el composite)', async () => {
    const errorSpy = vi.fn();
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '' })) as unknown as typeof fetch;
    const checker = new HibpCompromisedPasswordChecker(silentLogger({ error: errorSpy }), fetchFn);

    await expect(checker.check(pw('cualquieraSegura123'))).resolves.toBe('unavailable');
    expect(errorSpy).toHaveBeenCalledWith(LOG_EVENTS.PASSWORD_BREACH_CHECK_FAILED, { reason: 'HIBP API returned 503 Service Unavailable' });
  });
});