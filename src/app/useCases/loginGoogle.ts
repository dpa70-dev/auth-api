import { randomUUID } from 'node:crypto';
import { ApiError } from '../../domain/apiError.js';
import { ErrorCodes } from '../../domain/errorCatalog.js';
import { UniqueConstraintViolation } from '../../domain/uniqueConstraintViolation.js';
import type { GoogleIdTokenVerifier, Logger, TokenIssuer, UserRepository, RefreshTokenRepository } from '../../domain/port/index.js';
import { familyIdSchema, userIdSchema, providerSchema, userKindSchema, userRoleSchema, userStatusSchema, type Email, type Provider, type UserId } from '../../domain/vo/index.js';
import { validateNewUser } from '../../domain/entity/user.js';
import { LOG_EVENTS } from '../../domain/port/index.js';
import { issueSession } from '../helpers/issueSession.js';
import type { UseCase } from '../interfaces/useCase.js';

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
  user: { id: UserId; email: Email | null; kind: 'registered'; createdAt: string };
};

export class LoginGoogle implements UseCase<LoginGoogleCommand, LoginGoogleResult> {
  constructor(
    private readonly users: UserRepository,
    private readonly verifier: GoogleIdTokenVerifier,
    private readonly tokens: TokenIssuer,
    private readonly logger: Logger,
    private readonly refreshTokens: RefreshTokenRepository,
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
      // Invariante US-15/US-16: el guest nace con google_sub null y el upgrade jamás se lo asigna;
      // toda fila hallada por googleSub es registered. Guard explícito (el tipo UserRecord no lo codifica).
      if (known.kind !== userKindSchema.enum.registered) {
        throw new ApiError(ErrorCodes.UNAUTHORIZED);
      }
      // doc 04 → users.status: cuenta suspendida/baneada → 403 FORBIDDEN genérico (anti-enumeración).
      if (known.status !== userStatusSchema.enum.active) {
        throw new ApiError(ErrorCodes.FORBIDDEN);
      }
      return this.withSession(
        { id: known.id, email: known.email, kind: known.kind, createdAt: known.createdAt },
        providerSchema.enum.google,
        now,
        cmd.refreshTtlDays,
      );
    }

    // Primer inicio: alta implícita (US-07 AC-02, diagrama 5) — solo si el email está libre.
    const byEmail = await this.users.findByEmail(claims.email);
    if (byEmail) {
      // US-08 AC-02: colisión con cuenta solo-local → 409 SIN auto-linking.
      throw new ApiError(ErrorCodes.EMAIL_ALREADY_EXISTS, {
        details: [{ field: 'provider', issue: providerSchema.enum.local }],
      });
    }

    const id = userIdSchema.parse(randomUUID());
    try {
      await this.users.createUser({
        ...validateNewUser({
          id,
          email: claims.email,
          passwordHash: null,
          googleSub: claims.sub,
          emailVerified: true,
          kind: userKindSchema.enum.registered,
          role: userRoleSchema.enum.user,
          status: userStatusSchema.enum.active,
        }),
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

    return this.withSession(
      { id, email: claims.email, kind: userKindSchema.enum.registered, createdAt: now.toISOString() },
      providerSchema.enum.google,
      now,
      cmd.refreshTtlDays,
    );
  }

  private async withSession(
    user: { id: UserId; email: Email | null; kind: 'registered'; createdAt: string },
    provider: Provider,
    now: Date,
    refreshTtlDays: number,
  ): Promise<LoginGoogleResult> {
    const session = await issueSession(this.tokens, this.refreshTokens, {
      userId: user.id,
      familyId: familyIdSchema.parse(randomUUID()),
      provider,
      refreshTtlDays,
      now,
    });
    this.logger.info(LOG_EVENTS.USER_LOGGED_IN, { userId: user.id, provider });
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, user };
  }
}