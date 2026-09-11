import type { Request, Response } from 'express';
import { API_PREFIX, type Config } from '../config.js';

/** Nombre único de la cookie de sesión web (docs/06 §3.2) — fuente única del nombre. */
export const REFRESH_COOKIE = 'refresh_token';

const cookieOptions = (config: Config) => ({
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax' as const,
  path: `${API_PREFIX}/auth`,
});

/** Setea la cookie del refresh (web). Móvil ignora Set-Cookie y usa el body (docs/06 §3). */
export const setRefreshCookie = (res: Response, refreshToken: string, config: Config): void => {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(config),
    maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
};

/** Limpia la cookie del refresh (logout web) — mismas options que el set (Path/Domínio deben coincidir). */
export const clearRefreshCookie = (res: Response, config: Config): void => {
  res.clearCookie(REFRESH_COOKIE, cookieOptions(config));
};

/** Lee el refresh desde la cookie (web); undefined si el request no trae cookie (cookie-parser). */
export const readRefreshCookie = (req: Request): string | undefined => req.cookies?.[REFRESH_COOKIE];