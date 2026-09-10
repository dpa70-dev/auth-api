/** Screen de contraseñas contra listas de contraseñas comprometidas (NIST 800-63B §5.1.1.2).
 *  Tri-estado: el checker distingue "verificado limpio" de "no verificable" — la política de
 *  fallback/fail-open vive en el composite, no enterrada en cada implementación. */
import type { PlainPassword } from '../vo/index.js';

export type BreachCheckResult = 'clean' | 'compromised' | 'unavailable';

export interface CompromisedPasswordChecker {
  /**
   * 'compromised' ⇔ apareció en una filtración conocida (prohibida).
   * 'clean' ⇔ verificado contra el origen y NO está en la lista.
   * 'unavailable' ⇔ el origen no pudo consultarse (outage); el llamador decide la política.
   */
  check(password: PlainPassword): Promise<BreachCheckResult>;
}