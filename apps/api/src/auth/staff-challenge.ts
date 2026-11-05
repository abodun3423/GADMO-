import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The phone code must follow a correct password within this time. */
export const CHALLENGE_SECONDS = 5 * 60;
export const CHALLENGE_COOKIE = 'gadmo_staff_challenge';

/**
 * Proof that a staff member just gave the right password, kept in an httpOnly cookie and
 * signed by the server. It does not depend on Redis key expiry (which a computer with a
 * jumping clock can cut short); its age is checked against the API's own clock.
 */
export function issueChallenge(secret: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, t: now, n: randomBytes(12).toString('base64url') }),
  ).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** The challenge's user and nonce if it is genuine and fresh, otherwise null. */
export function readChallenge(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): { userId: string; nonce: string } | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { u, t, n } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      u?: unknown;
      t?: unknown;
      n?: unknown;
    };
    if (typeof u !== 'string' || typeof t !== 'number' || typeof n !== 'string') return null;
    const age = now - t;
    if (age < 0 || age > CHALLENGE_SECONDS * 1000) return null;
    return { userId: u, nonce: n };
  } catch {
    return null;
  }
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`staff-challenge:${payload}`).digest('base64url');
}
