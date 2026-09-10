import type { BreachCheckResult, CompromisedPasswordChecker, Logger } from '../domain/port/index.js';
import { LOG_EVENTS } from '../domain/port/index.js';
import type { PlainPassword } from '../domain/vo/index.js';

/**
 * Failover online→local (NIST 800-63B §5.1.1.2). El no-verificable del primario dispara el
 * fallback local; si ambos fallan, el fail-open final (permitir) queda EXPLÍCITO aquí, con log.
 */
export class CompositeCompromisedPasswordChecker implements CompromisedPasswordChecker {
  constructor(
    private readonly primary: CompromisedPasswordChecker,
    private readonly fallback: CompromisedPasswordChecker,
    private readonly logger: Logger,
  ) {}

  async check(password: PlainPassword): Promise<BreachCheckResult> {
    const primaryResult = await this.primary.check(password);
    if (primaryResult !== 'unavailable') return primaryResult;

    const fallbackResult = await this.fallback.check(password);
    this.logger.warn(LOG_EVENTS.PASSWORD_BREACH_CHECK_FALLBACK, {
      reason: 'hibp_unavailable',
      outcome: fallbackResult,
    });
    // El fallback local nunca responde 'unavailable'; si algún día lo hiciera, fail-open (no bloquear altas).
    return fallbackResult === 'compromised' ? 'compromised' : 'clean';
  }
}