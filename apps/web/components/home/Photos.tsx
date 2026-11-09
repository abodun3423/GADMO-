import type { Photo } from '@/lib/images';

/**
 * Three photos fanned out like prints on a table: the bold image on laptops. Hidden on
 * phones, where the small face row is used instead (less data).
 */
export function PhotoStack({ photos, eager = false }: { photos: Photo[]; eager?: boolean }) {
  return (
    <div className="photo-stack" aria-hidden="true">
      {photos.slice(0, 3).map((p, i) => (
        <figure key={p.src} className={`photo-card photo-card-${i + 1}`}>
          <img
            src={p.src}
            alt=""
            width={560}
            height={695}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
          <figcaption>{p.trade}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/** A row of small round faces with a caption, for phones. */
export function FaceRow({ photos, caption }: { photos: Photo[]; caption: string }) {
  return (
    <div className="face-row">
      <ul aria-hidden="true">
        {photos.map((p) => (
          <li key={p.small}>
            <img src={p.small} alt="" width={200} height={248} decoding="async" />
          </li>
        ))}
      </ul>
      <p>{caption}</p>
    </div>
  );
}

/** One photo in a rounded frame with a trade label. */
export function PhotoCard({
  photo,
  className = '',
  eager = false,
}: {
  photo: Photo;
  className?: string;
  eager?: boolean;
}) {
  return (
    <figure className={`photo-card photo-single ${className}`}>
      <img
        src={photo.src}
        alt={photo.alt}
        width={560}
        height={695}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      <figcaption>{photo.trade}</figcaption>
    </figure>
  );
}
