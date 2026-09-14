import type { InsertRefreshToken, TokenIssuer, UserRepository } from '../../domain/port/index.js';
import type { FamilyId, Provider, UserId } from '../../domain/vo/index.js';
import { refreshExpiresAt } from '../../domain/refreshExpiry.js';

export type IssueSessionInput = {
  userId: UserId;
  familyId: FamilyId;
  provider: Provider;
  refreshTtlDays: number;
  now: Date;
};

export type GeneratedSession = {
  accessToken: string;
  refreshToken: string;
  refreshRow: InsertRefreshToken;
};

/**
 * SOLO crypto/material de sesión — NO toca la DB. Para emitir el material FUERA de la transacción
 * (doc 13 → §13.1: llamadas lentas o de red nunca dentro de BEGIN/COMMIT) y persistir el refresh
 * DENTRO de la tx vía insertRefreshToken(refreshRow).
 */
export const generateSession = async (
  tokens: TokenIssuer,
  input: IssueSessionInput,
): Promise<GeneratedSession> => {
  const [accessToken, refresh] = await Promise.all([
    tokens.issueAccessToken(input.userId, input.now),
    tokens.issueRefreshToken(input.now),
  ]);
  const tokenHash = await tokens.hashRefreshToken(refresh.rawToken);
  return {
    accessToken,
    refreshToken: refresh.rawToken,
    refreshRow: {
      jti: refresh.jti,
      tokenHash,
      userId: input.userId,
      familyId: input.familyId,
      provider: input.provider,
      expiresAt: refreshExpiresAt(input.now, input.refreshTtlDays),
    },
  };
};

/** Emisión completa de una sesión (US-03 AC-02): generateSession + persistencia del refresh. Para use cases SIN tx propia. */
export const issueSession = async (
  tokens: TokenIssuer,
  users: UserRepository,
  input: IssueSessionInput,
): Promise<{ accessToken: string; refreshToken: string }> => {
  const { accessToken, refreshToken, refreshRow } = await generateSession(tokens, input);
  await users.insertRefreshToken(refreshRow);
  return { accessToken, refreshToken };
};