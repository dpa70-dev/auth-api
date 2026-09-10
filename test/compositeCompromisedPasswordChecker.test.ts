import { describe, expect, it, vi } from 'vitest';
import { CompositeCompromisedPasswordChecker } from '../src/infra/compositeCompromisedPasswordChecker.js';
import { LOG_EVENTS } from '../src/domain/port/index.js';
import type { BreachCheckResult, CompromisedPasswordChecker, Logger } from '../src/domain/port/index.js';
import type { PlainPassword } from '../src/domain/vo/index.js';

const silentLogger = (overrides: Partial<Logger> = {}): Logger => ({ info() {}, warn() {}, error() {}, ...overrides });

const pw = (s: string): PlainPassword => s as PlainPassword;

/** Fake del puerto con resultado fijo. */
const fixedResult = (result: BreachCheckResult): CompromisedPasswordChecker => ({
  check: async () => result,
});

describe('CompositeCompromisedPasswordChecker — failover online→local', () => {
  it('propaga el resultado del primario cuando no es unavailable', async () => {
    const checker = new CompositeCompromisedPasswordChecker(fixedResult('compromised'), fixedResult('clean'), silentLogger());

    await expect(checker.check(pw('x'))).resolves.toBe('compromised');
  });

  it('consulta el fallback y loguea PASSWORD_BREACH_CHECK_FALLBACK cuando el primario es unavailable', async () => {
    const warnSpy = vi.fn();
    const checker = new CompositeCompromisedPasswordChecker(fixedResult('unavailable'), fixedResult('compromised'), silentLogger({ warn: warnSpy }));

    await expect(checker.check(pw('x'))).resolves.toBe('compromised');
    expect(warnSpy).toHaveBeenCalledWith(
      LOG_EVENTS.PASSWORD_BREACH_CHECK_FALLBACK,
      expect.objectContaining({ reason: 'hibp_unavailable', outcome: 'compromised' }),
    );
  });

  it('fail-open final: primario unavailable y fallback clean → clean (nunca bloquea el alta)', async () => {
    const warnSpy = vi.fn();
    const checker = new CompositeCompromisedPasswordChecker(fixedResult('unavailable'), fixedResult('clean'), silentLogger({ warn: warnSpy }));

    await expect(checker.check(pw('x'))).resolves.toBe('clean');
    expect(warnSpy).toHaveBeenCalledWith(LOG_EVENTS.PASSWORD_BREACH_CHECK_FALLBACK, expect.objectContaining({ outcome: 'clean' }));
  });

  it('no loguea fallback cuando el primario responde', async () => {
    const warnSpy = vi.fn();
    const checker = new CompositeCompromisedPasswordChecker(fixedResult('clean'), fixedResult('compromised'), silentLogger({ warn: warnSpy }));

    await expect(checker.check(pw('x'))).resolves.toBe('clean');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});