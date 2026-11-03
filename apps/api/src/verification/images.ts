/** Identity photos: phones resize them before upload, so 2 MB is plenty. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const UPLOAD_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type UploadImageType = (typeof UPLOAD_IMAGE_TYPES)[number];

/**
 * The real type from the file's first bytes; the Content-Type header alone is not
 * trusted. Returns null for anything that isn't a JPEG, PNG or WebP image.
 */
export function sniffImageType(bytes: unknown): UploadImageType | null {
  if (typeof bytes === 'string' || Array.isArray(bytes) || !Buffer.isBuffer(bytes)) return null;
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
