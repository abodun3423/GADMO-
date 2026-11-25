'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError, postBlob } from '@/lib/api';
import { shrinkPhoto } from '@/lib/photo';
import type { WorkPhoto } from '@/lib/types';

/**
 * A Pro's photos of past work, shown on their public profile (founder decisions: up to 8,
 * shown at once; GADMO staff remove any that break the rules).
 */
export function ProWorkPhotos({ proId }: { proId: string }) {
  const [photos, setPhotos] = useState<WorkPhoto[] | null>(null);
  const [max, setMax] = useState(8);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ photos: WorkPhoto[]; max: number }>('/v1/pro/photos')
      .then((r) => {
        setPhotos(r.photos);
        setMax(r.max);
      })
      .catch(() => setError('Your photos could not be loaded. Refresh to try again.'));
  }, []);

  async function add(file: File | undefined) {
    if (!file) return;
    setBusy('Adding photo…');
    setError(null);
    try {
      const photo = await shrinkPhoto(file, 1600);
      const query = caption.trim() ? `?caption=${encodeURIComponent(caption.trim())}` : '';
      const res = await postBlob<{ photo: WorkPhoto }>(`/v1/pro/photos${query}`, photo);
      setPhotos((p) => [...(p ?? []), res.photo]);
      setCaption('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The photo was not added. Try again.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string) {
    setBusy('Removing…');
    setError(null);
    try {
      await api(`/v1/pro/photos/${id}`, { method: 'DELETE' });
      setPhotos((p) => (p ?? []).filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not removed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const full = (photos?.length ?? 0) >= max;
  return (
    <section className="panel" aria-labelledby="work-photos-title">
      <h2 id="work-photos-title" className="panel-title">
        Photos of your work
      </h2>
      <p className="meta">
        Show customers jobs you’ve done, up to {max} photos. They appear on your profile at once. No
        phone numbers, signboards with contacts, or other people’s work: GADMO staff remove photos
        that break these rules.
      </p>
      {photos && photos.length > 0 && (
        <ul className="photo-grid">
          {photos.map((p) => (
            <li key={p.id}>
              <img
                src={`/v1/pros/${proId}/photos/${p.id}`}
                alt={p.caption ?? 'Photo of your work'}
                loading="lazy"
              />
              {p.caption && <p className="meta">{p.caption}</p>}
              <button
                className="button button-quiet button-small"
                type="button"
                disabled={busy !== null}
                onClick={() => remove(p.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {photos && !full && (
        <>
          <div className="field">
            <label htmlFor="photo-caption">
              Caption <span className="hint">Optional, e.g. “Kitchen rewiring, Ado-Ekiti”</span>
            </label>
            <input
              id="photo-caption"
              maxLength={100}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <label className="button button-ghost file-button">
            {busy ?? 'Add a photo'}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => void add(e.target.files?.[0])}
            />
          </label>
        </>
      )}
      {full && <p className="meta">You’re showing {max} photos. Remove one to add another.</p>}
    </section>
  );
}
