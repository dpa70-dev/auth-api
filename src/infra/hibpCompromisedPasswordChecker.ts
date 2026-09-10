import { createHash } from 'node:crypto';
import type { BreachCheckResult, CompromisedPasswordChecker, Logger } from '../domain/port/index.js';
import { LOG_EVENTS } from '../domain/port/index.js';
import type { PlainPassword } from '../domain/vo/index.js';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

export class HibpCompromisedPasswordChecker implements CompromisedPasswordChecker {
  constructor(
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async check(password: PlainPassword): Promise<BreachCheckResult> {
    try {
      const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      const url = `${HIBP_RANGE_URL}${prefix}`;
      const response = await this.fetchFn(url, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.error(LOG_EVENTS.PASSWORD_BREACH_CHECK_FAILED, {
          reason: `HIBP API returned ${response.status} ${response.statusText}`,
        });
        return 'unavailable';
      }

      const body = await response.text();
      const lines = body.split('\n');
      let found = false;
      for (const line of lines) {
        // Formato HIBP: SUFFIX:COUNT por línea; sufijo en mayúsculas, contador de apariciones.
        const hashSuffix = line.split(':')[0];
        if (hashSuffix !== undefined && hashSuffix.toUpperCase() === suffix) {
          found = true;
          break;
        }
      }
      return found ? 'compromised' : 'clean';
    } catch (err) {
      // La indisponibilidad NO es "limpio": se reporta para que el composite decida el fallback.
      this.logger.error(LOG_EVENTS.PASSWORD_BREACH_CHECK_FAILED, {
        reason: String(err),
      });
      return 'unavailable';
    }
  }
}