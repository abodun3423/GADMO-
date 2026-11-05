import { describe, expect, it } from 'vitest';
import { CHALLENGE_SECONDS, issueChallenge, readChallenge } from './staff-challenge';

const secret = 'test-only-secret-for-staff-challenges-xxxxxxxx';

describe('staff challenge', () => {
  it('is accepted for 5 minutes, for the user it was issued to', () => {
    const t = 1_800_000_000_000;
    const token = issueChallenge(secret, 'user-1', t);
    expect(readChallenge(secret, token, t + 1000)?.userId).toBe('user-1');
    expect(readChallenge(secret, token, t + CHALLENGE_SECONDS * 1000)).not.toBeNull();
    expect(readChallenge(secret, token, t + CHALLENGE_SECONDS * 1000 + 1)).toBeNull();
    expect(readChallenge(secret, token, t - 1)).toBeNull();
  });

  it('refuses forged, altered or missing challenges', () => {
    const token = issueChallenge(secret, 'user-1');
    const [payload, sig] = token.split('.');
    const otherUser = Buffer.from(JSON.stringify({ u: 'user-2', t: Date.now(), n: 'x' })).toString(
      'base64url',
    );
    expect(readChallenge(secret, `${otherUser}.${sig}`)).toBeNull();
    expect(readChallenge('another-secret', token)).toBeNull();
    expect(readChallenge(secret, `${payload}`)).toBeNull();
    expect(readChallenge(secret, undefined)).toBeNull();
    expect(readChallenge(secret, 'garbage.garbage')).toBeNull();
  });
});
