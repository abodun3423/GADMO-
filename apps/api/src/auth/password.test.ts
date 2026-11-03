import { describe, expect, it } from 'vitest';
import { DECOY_HASH, hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(a).not.toContain('horse');
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', a)).toBe(false);
  });

  it('never matches the decoy or a malformed hash', async () => {
    expect(await verifyPassword('anything', DECOY_HASH)).toBe(false);
    expect(await verifyPassword('anything', 'md5$abc')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});
