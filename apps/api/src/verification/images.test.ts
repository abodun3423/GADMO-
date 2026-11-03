import { describe, expect, it } from 'vitest';
import { sniffImageType } from './images';

const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);

describe('sniffImageType', () => {
  it('recognises JPEG, PNG and WebP by their bytes', () => {
    expect(sniffImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
      Buffer.alloc(8),
    ]);
    expect(sniffImageType(webp)).toBe('image/webp');
  });

  it('refuses anything else, whatever it is called', () => {
    expect(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBeNull();
    expect(sniffImageType(Buffer.from('%PDF-1.7 ......'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(4))).toBeNull();
  });
});
