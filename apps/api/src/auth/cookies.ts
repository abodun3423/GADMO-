import type { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './token.service';

export const ACCESS_COOKIE = 'gadmo_at';
export const REFRESH_COOKIE = 'gadmo_rt';
/** The refresh cookie is only ever sent to the auth routes. */
export const REFRESH_COOKIE_PATH = '/v1/auth';

function base(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax' };
}

export function setAuthCookies(
  res: Response,
  access: string,
  refresh: string,
  secure: boolean,
): void {
  res.cookie(ACCESS_COOKIE, access, {
    ...base(secure),
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, refresh, {
    ...base(secure),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(secure), path: '/' });
  res.clearCookie(REFRESH_COOKIE, {
    ...base(secure),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}
