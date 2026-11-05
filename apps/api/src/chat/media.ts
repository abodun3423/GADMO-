/** Voice notes: recorded in the browser, at most 60 seconds at a low bitrate. */
export const MAX_VOICE_BYTES = 1024 * 1024;
export const VOICE_NOTE_SECONDS = 60;
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac'] as const;
export type AudioType = 'audio/webm' | 'audio/ogg' | 'audio/mp4';

/**
 * The real audio container from the file's first bytes (the Content-Type header alone is
 * not trusted): WebM (Chrome, Android), Ogg (Firefox) or MP4 (Safari, iPhone).
 */
export function sniffAudioType(bytes: unknown): AudioType | null {
  if (typeof bytes === 'string' || Array.isArray(bytes) || !Buffer.isBuffer(bytes)) return null;
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (bytes.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
  return null;
}
