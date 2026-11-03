/**
 * Shrinks a phone photo before upload (a 12 MP camera photo is several MB; this keeps it
 * to a few hundred KB on paid data) and re-encodes it as JPEG, which also drops the
 * photo's location metadata.
 */
export async function shrinkPhoto(file: Blob, maxSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare photos');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo'))),
      'image/jpeg',
      0.82,
    ),
  );
}
