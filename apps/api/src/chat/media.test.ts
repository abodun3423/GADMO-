import { describe, expect, it } from 'vitest';
import { sniffAudioType } from './media';

const pad = (head: number[] | Buffer) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);

describe('sniffAudioType', () => {
  it('recognises WebM, Ogg and MP4 audio by their first bytes', () => {
    expect(sniffAudioType(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe('audio/webm');
    expect(sniffAudioType(pad(Buffer.from('OggS')))).toBe('audio/ogg');
    expect(sniffAudioType(pad(Buffer.from('\0\0\0\x18ftypM4A ', 'latin1')))).toBe('audio/mp4');
  });

  it('refuses anything else, including text pretending to be audio', () => {
    expect(sniffAudioType(pad(Buffer.from('<script>alert(1)</script>')))).toBeNull();
    expect(sniffAudioType(Buffer.from('short'))).toBeNull();
    expect(sniffAudioType('OggS............')).toBeNull();
    expect(sniffAudioType(['OggS'])).toBeNull();
    expect(sniffAudioType({})).toBeNull();
  });
});
