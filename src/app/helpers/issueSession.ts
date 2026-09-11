import type { TokenIssuer, UserRepository } from '../../domain/port/index.js';
import type { FamilyId, Provider, UserId } from '../../domain/vo/index.js';
import { refreshExpiresAt } from '../../domain/refreshExpiry.js';

export type IssueSessionInput = {
  userId: UserId;
  familyId: FamilyId;
  provider: Provider;
  refreshTtlDays: number;
  now: Date;
};

/** Emisión de una sesión completa (US-03 AC-02): access + refresh + persistencia del refresh. */
export const issueSession = async (
  tokens: TokenIssuer,
  users: UserRepository,
  input: IssueSessionInput,
): Promise<{ accessToken: string; refreshToken: string }> => {
  const [accessToken, refresh] = await Promise.all([
    tokens.issueAccessToken(input.userId, input.now),
    tokens.issueRefreshToken(input.now),
  ]);
  const tokenHash = await tokens.hashRefreshToken(refresh.rawToken);
  await users.insertRefreshToken({
    jti: refresh.jti,
    tokenHash,
    userId: input.userId,
    familyId: input.familyId,
    provider: input.provider,
    expiresAt: refreshExpiresAt(input.now, input.refreshTtlDays),
  });
  return { accessToken, refreshToken: refresh.rawToken };
};