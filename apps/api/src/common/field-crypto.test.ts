import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FieldCrypto } from './field-crypto';

const crypto = new FieldCrypto(randomBytes(32).toString('base64'));

describe('FieldCrypto', () => {
  it('round-trips text and bytes, with a fresh IV every time', () => {
    const a = crypto.encrypt('12345678901');
    const b = crypto.encrypt('12345678901');
    expect(a).not.toBe(b);
    expect(a).not.toContain('12345678901');
    expect(crypto.decrypt(a).toString()).toBe('12345678901');
    const bytes = randomBytes(5000);
    expect(crypto.decrypt(crypto.encrypt(bytes)).equals(bytes)).toBe(true);
  });

  it('refuses tampered data and other keys', () => {
    const sealed = crypto.encrypt('12345678901');
    const raw = Buffer.from(sealed.slice(3), 'base64');
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 1, raw.length - 1);
    expect(() => crypto.decrypt(`v1.${raw.toString('base64')}`)).toThrow();
    const other = new FieldCrypto(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(sealed)).toThrow();
    expect(() => crypto.decrypt('v0.abc')).toThrow(/format/);
  });

  it('needs a 32-byte key', () => {
    expect(() => new FieldCrypto(randomBytes(16).toString('base64'))).toThrow();
  });
});
