import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * AES-256-GCM for sensitive fields (NINs, identity photos). Output is
 * "v1.<base64 of iv(12) | tag(16) | ciphertext>", so the key or scheme can change later.
 */
export class FieldCrypto {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('Field encryption key must be 32 bytes');
  }

  encrypt(plain: Buffer | string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
  }

  decrypt(sealed: string): Buffer {
    const [version, body] = sealed.split('.');
    if (version !== VERSION || !body) throw new Error('Unknown ciphertext format');
    const raw = Buffer.from(body, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  }
}
