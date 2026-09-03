import { ApiError } from '../domain/apiError.js';
import { ErrorCodes } from '../domain/errorCatalog.js';
import { UniqueConstraintViolation } from '../domain/uniqueConstraintViolation.js';
import type { GoogleIdTokenVerifier, Logger, TokenIssuer, UserRepository } from '../domain/port/index.js';
import { userIdSchema, providerSchema, type Email, type Provider, type UserId } from '../domain/vo/index.js';
import { LOG_EVENTS } from '../domain/port/index.js';
import { issueSession } from './issueSession.js';

export type LoginGoogleCommand = {
  idToken: string;
  /** Nonce generado por el cliente al solicitar el ID token a Google (anti-replay, US-07 AC-03). */
  nonce?: string;
  refreshTtlDays: number;
  now?: Date;
};

export type LoginGoogleResult = {
  accessToken: string;
  refreshToken: string;
  user: { id: UserId; email: Email; createdAt: string };
};

export class LoginGoogle {
  constructor(
    private readonly users: UserRepository,
    private readonly verifier: GoogleIdTokenVerifier,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
  ) {}

  async execute(cmd: LoginGoogleCommand): Promise<LoginGoogleResult> {
    const now = cmd.now ?? new Date();

    // US-07 AC-03: verificación estrictamente server-side (aud, iss, exp/iat, RS256, firma, nonce).
    const claims = await this.verifier.verify(cmd.idToken, cmd.nonce);
    if (!claims) throw new ApiError(ErrorCodes.UNAUTHORIZED);

    // US-07 AC-04: el server confía en el email SOLO si email_verified es true.
    if (!claims.emailVerified) throw new ApiError(ErrorCodes.EMAIL_NOT_VERIFIED);

    const known = await this.users.findByGoogleSub(claims.sub);
    if (known) {
      return this.withSession(known, providerSchema.enum.google, now, cmd.refreshTtlDays);
    }

    // Primer inicio: alta implícita (US-07 AC-02, diagrama 5) — solo si el email está libre.
    const byEmail = await this.users.findByEmail(claims.email);
    if (byEmail) {
      // US-08 AC-02: colisión con cuenta solo-local → 409 SIN auto-linking.
      throw new ApiError(ErrorCodes.EMAIL_ALREADY_EXISTS, {
        details: [{ field: 'provider', issue: providerSchema.enum.local }],
      });
    }

    const id = userIdSchema.parse(crypto.randomUUID());
    try {
      await this.users.createUser({
        id,
        email: claims.email,
        passwordHash: null,
        googleSub: claims.sub,
        emailVerified: true,
        createdAt: now.toISOString(),
      });
    } catch (err) {
      if (err instanceof UniqueConstraintViolation) {
        throw new ApiError(ErrorCodes.EMAIL_ALREADY_EXISTS, {
          details: [{ field: 'provider', issue: providerSchema.enum.local }],
        });
      }
      throw err;
    }

    return this.withSession({ id, email: claims.email, createdAt: now.toISOString() }, providerSchema.enum.google, now, cmd.refreshTtlDays);
  }

  private async withSession(
    user: { id: UserId; email: Email; createdAt: string },
    provider: Provider,
    now: Date,
    refreshTtlDays: number,
  ): Promise<LoginGoogleResult> {
    const session = await issueSession(this.tokens, this.users, {
      userId: user.id,
      provider,
      refreshTtlDays,
      now,
    });
    this.logger.info(LOG_EVENTS.USER_LOGGED_IN, { userId: user.id, provider });
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, user };
  }
}