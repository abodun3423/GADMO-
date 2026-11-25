'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';
import { AdminNav } from './AdminNav';
import { StaffOnly } from './StaffOnly';

interface StaffWorkPhoto {
  id: string;
  proId: string;
  proName: string | null;
  caption: string | null;
  createdAt: string;
  removedAt: string | null;
}

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/**
 * Every new photo Pros add to their profile, newest first (founder decision: photos show
 * at once; staff remove any with contact details, or that aren't the Pro's own work).
 */
export function WorkPhotoList() {
  return (
    <StaffOnly next="/admin/photos">
      <List />
    </StaffOnly>
  );
}

function List() {
  const [photos, setPhotos] = useState<StaffWorkPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ photos: StaffWorkPhoto[] }>('/v1/admin/work-photos')
      .then((r) => setPhotos(r.photos))
      .catch(() => setError('The photos could not be loaded. Check your connection and refresh.'));
  }, []);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try {
      await post(`/v1/admin/work-photos/${id}/remove`);
      setPhotos((all) =>
        (all ?? []).map((p) => (p.id === id ? { ...p, removedAt: new Date().toISOString() } : p)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not removed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Work photos</h1>
      <p className="lede">
        New photos Pros added to their profiles. Remove any that show phone numbers or other contact
        details, or that aren’t the Pro’s own work.
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {photos?.length === 0 && <p className="empty">No photos yet.</p>}
      <ul className="photo-grid">
        {photos?.map((p) => (
          <li key={p.id} className={p.removedAt ? 'photo-removed' : undefined}>
            {p.removedAt ? (
              <p className="meta">Removed {dateFormat.format(new Date(p.removedAt))}</p>
            ) : (
              <img src={`/v1/pros/${p.proId}/photos/${p.id}`} alt={p.caption ?? 'Work photo'} />
            )}
            <p className="meta">
              <Link href={`/admin/users/${p.proId}`}>{p.proName ?? 'Pro'}</Link> ·{' '}
              {dateFormat.format(new Date(p.createdAt))}
            </p>
            {p.caption && <p className="meta">“{p.caption}”</p>}
            {!p.removedAt && (
              <button
                className="button button-quiet button-small"
                type="button"
                disabled={busy !== null}
                onClick={() => remove(p.id)}
              >
                {busy === p.id ? 'Removing…' : 'Remove photo'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
