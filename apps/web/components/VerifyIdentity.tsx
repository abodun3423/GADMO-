'use client';

import Link from 'next/link';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post, putImage } from '@/lib/api';
import { shrinkPhoto } from '@/lib/photo';
import type { VerificationState } from '@/lib/types';
import { useSession } from '@/lib/useSession';

type Kind = 'id-document' | 'selfie';
type PhotoState = { status: 'empty' | 'uploading' | 'done' | 'error'; preview?: string };

const dateFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long' });

export function VerifyIdentity() {
  const { me, loading } = useSession();
  const [state, setState] = useState<VerificationState | null>(null);
  const [nin, setNin] = useState('');
  const [photos, setPhotos] = useState<Record<Kind, PhotoState>>({
    'id-document': { status: 'empty' },
    selfie: { status: 'empty' },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { verification } = await api<{ verification: VerificationState }>(
        '/v1/pro/verification',
      );
      setState(verification);
      setPhotos((current) => ({
        'id-document': verification.photos.idDocument
          ? { ...current['id-document'], status: 'done' }
          : { status: 'empty' },
        selfie: verification.photos.selfie
          ? { ...current.selfie, status: 'done' }
          : { status: 'empty' },
      }));
    } catch {
      setError('Your identity check could not be loaded. Check your connection and refresh.');
    }
  }, []);

  useEffect(() => {
    if (me?.role === 'PRO') void load();
  }, [me, load]);

  async function choose(kind: Kind, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPhotos((p) => ({ ...p, [kind]: { status: 'uploading' } }));
    try {
      const photo = await shrinkPhoto(file, kind === 'selfie' ? 800 : 1600);
      await putImage(`/v1/pro/verification/photos/${kind}`, photo);
      setPhotos((p) => {
        if (p[kind].preview) URL.revokeObjectURL(p[kind].preview);
        return { ...p, [kind]: { status: 'done', preview: URL.createObjectURL(photo) } };
      });
    } catch (err) {
      setPhotos((p) => ({ ...p, [kind]: { status: 'error' } }));
      setError(
        err instanceof ApiError
          ? err.message
          : 'That photo could not be used. Try again, or choose a different photo.',
      );
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{11}$/.test(nin.replace(/[\s-]/g, ''))) {
      setError('Your NIN has 11 digits.');
      return;
    }
    if (photos['id-document'].status !== 'done' || photos.selfie.status !== 'done') {
      setError('Add a photo of your ID and a selfie first.');
      return;
    }
    setBusy(true);
    try {
      const { verification } = await post<{ verification: VerificationState }>(
        '/v1/pro/verification',
        { nin },
      );
      setState(verification);
      setNin('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(
        fieldMessage(err) ??
          (err instanceof ApiError ? err.message : 'Could not send. Check your connection.'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;

  if (!me || me.role !== 'PRO') {
    return (
      <>
        <h1 className="page-title">Verify your identity</h1>
        <p className="lede">
          {me ? 'This page is for Pros.' : 'Sign in with your Pro account to verify your identity.'}
        </p>
        <Link className="button" href={me ? '/' : '/signin?next=%2Fpro%2Fverify'}>
          {me ? 'Find a service' : 'Sign in'}
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Verify your identity</h1>
      <p className="lede">
        Customers book verified Pros with confidence. Once GADMO has checked it’s you, you get the
        verified badge and can go online.
      </p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!state && !error && <p className="meta">Loading…</p>}

      {state?.status === 'APPROVED' && (
        <div className="status status-online">
          <h2>You’re verified</h2>
          <p>Customers see your verified badge.</p>
          <Link className="button" href="/pro">
            Go to Pro home
          </Link>
        </div>
      )}

      {state?.status === 'PENDING' && (
        <div className="status" role="status">
          <h2>Under review</h2>
          <p>
            Sent{state.submittedAt ? ` on ${dateFormat.format(new Date(state.submittedAt))}` : ''}.
            GADMO is checking your details and will let you know.
          </p>
          <Link className="button button-quiet" href="/pro">
            Go to Pro home
          </Link>
        </div>
      )}

      {state?.canSubmit && (
        <>
          {state.note && (
            <div className="alert alert-error">
              <strong>
                {state.status === 'NEEDS_INFO'
                  ? 'GADMO needs a little more from you:'
                  : 'Your last check was not approved:'}
              </strong>{' '}
              {state.note}
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="nin">
                Your NIN
                <span className="hint">
                  11 digits. It’s on your NIN slip or ID card, or dial *346# from the phone number
                  you registered with NIMC.
                </span>
              </label>
              <input
                id="nin"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                value={nin}
                onChange={(e) => setNin(e.target.value.replace(/[^\d\s-]/g, ''))}
              />
            </div>

            <PhotoField
              id="id-photo"
              label="Photo of your ID"
              hint="NIN slip, national ID card, voter’s card, driver’s licence or passport. All four corners in view, no glare."
              capture="environment"
              state={photos['id-document']}
              onChange={(e) => choose('id-document', e)}
            />
            <PhotoField
              id="selfie"
              label="A selfie"
              hint="Face the camera in good light. No cap or sunglasses."
              capture="user"
              state={photos.selfie}
              onChange={(e) => choose('selfie', e)}
            />

            <p className="meta">
              Only GADMO staff can see these, to confirm it’s you. Your NIN is stored encrypted and
              is never shown to customers.
            </p>
            <button className="button" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send for review'}
            </button>
          </form>
        </>
      )}
    </>
  );
}

function PhotoField({
  id,
  label,
  hint,
  capture,
  state,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  capture: 'user' | 'environment';
  state: PhotoState;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="field photo-field">
      <span className="label" id={`${id}-label`}>
        {label}
        <span className="hint">{hint}</span>
      </span>
      {state.preview && (
        // A local preview of the photo just taken (a blob: URL, never uploaded anywhere else).
        <img className="photo-preview" src={state.preview} alt={`Your ${label.toLowerCase()}`} />
      )}
      <p className="meta" aria-live="polite">
        {state.status === 'uploading' && 'Uploading…'}
        {state.status === 'done' && '✓ Added'}
        {state.status === 'error' && 'Not added. Try again.'}
      </p>
      <label className="button button-quiet" htmlFor={id}>
        {state.status === 'done' ? 'Change photo' : 'Take or choose a photo'}
      </label>
      <input
        id={id}
        className="sr-only"
        type="file"
        accept="image/*"
        capture={capture}
        aria-labelledby={`${id}-label`}
        onChange={onChange}
        disabled={state.status === 'uploading'}
      />
    </div>
  );
}
