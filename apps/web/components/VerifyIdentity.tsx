'use client';

import Link from 'next/link';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post, putImage } from '@/lib/api';
import { shrinkPhoto } from '@/lib/photo';
import type { VerificationState } from '@/lib/types';
import { useSession } from '@/lib/useSession';

type Kind = 'id-document' | 'selfie' | 'attestation' | 'certificate';
type Links = { linkedin: string; github: string; portfolio: string };

const NO_PHOTOS: Record<Kind, PhotoState> = {
  'id-document': { status: 'empty' },
  selfie: { status: 'empty' },
  attestation: { status: 'empty' },
  certificate: { status: 'empty' },
};
type PhotoState = { status: 'empty' | 'uploading' | 'done' | 'error'; preview?: string };

const dateFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long' });

export function VerifyIdentity() {
  const { me, loading } = useSession();
  const [state, setState] = useState<VerificationState | null>(null);
  const [nin, setNin] = useState('');
  const [trainedAt, setTrainedAt] = useState('');
  const [trainedBy, setTrainedBy] = useState('');
  const [trainerPhone, setTrainerPhone] = useState('');
  const [links, setLinks] = useState<Links>({ linkedin: '', github: '', portfolio: '' });
  const [photos, setPhotos] = useState<Record<Kind, PhotoState>>(NO_PHOTOS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { verification } = await api<{ verification: VerificationState }>(
        '/v1/pro/verification',
      );
      setState(verification);
      const has: Record<Kind, boolean> = {
        'id-document': verification.photos.idDocument,
        selfie: verification.photos.selfie,
        attestation: verification.photos.attestation,
        certificate: verification.photos.certificate,
      };
      setPhotos((current) => {
        const next = { ...NO_PHOTOS };
        for (const kind of Object.keys(has) as Kind[]) {
          if (has[kind]) next[kind] = { ...current[kind], status: 'done' };
        }
        return next;
      });
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
    if (trainedAt.trim().length < 2 || trainedBy.trim().length < 2) {
      setError('Tell us where you learned your trade and who trained you.');
      return;
    }
    if (photos.attestation.status !== 'done' && photos.certificate.status !== 'done') {
      setError('Add a photo of your attestation letter or your certificate.');
      return;
    }
    const givenLinks = Object.fromEntries(Object.entries(links).filter(([, v]) => v.trim() !== ''));
    setBusy(true);
    try {
      const { verification } = await post<{ verification: VerificationState }>(
        '/v1/pro/verification',
        {
          nin,
          trainedAt,
          trainedBy,
          ...(trainerPhone.trim() ? { trainerPhone } : {}),
          ...(state?.techLinks && Object.keys(givenLinks).length ? { links: givenLinks } : {}),
        },
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
      <h1 className="page-title">Get verified</h1>
      <p className="lede">
        Customers book verified Pros with confidence. Verification has two steps: first you send
        your ID and proof of your skill here; then a GADMO agent visits you to see your work. After
        both, you get the verified badge and can go online.
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

            <h2 className="section-title">Proof of your skill</h2>
            <p className="meta">
              Tell us where you learned your trade. Add a photo of an attestation letter from your
              master, workshop or school, or of your certificate. You need at least one.
            </p>
            <div className="field">
              <label htmlFor="trained-at">
                Where you learned
                <span className="hint">The workshop, business or school, and its town.</span>
              </label>
              <input
                id="trained-at"
                type="text"
                maxLength={120}
                value={trainedAt}
                onChange={(e) => setTrainedAt(e.target.value)}
                placeholder="e.g. Adeyemi Auto Workshop, Ado-Ekiti"
              />
            </div>
            <div className="field">
              <label htmlFor="trained-by">
                Who trained you
                <span className="hint">Your master, teacher or instructor.</span>
              </label>
              <input
                id="trained-by"
                type="text"
                maxLength={80}
                value={trainedBy}
                onChange={(e) => setTrainedBy(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="trainer-phone">
                Their phone number (optional)
                <span className="hint">
                  So GADMO can call them to confirm. Only GADMO staff see it.
                </span>
              </label>
              <input
                id="trainer-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={20}
                value={trainerPhone}
                onChange={(e) => setTrainerPhone(e.target.value)}
              />
            </div>
            <PhotoField
              id="attestation"
              label="Attestation letter"
              hint="A signed letter from your master, workshop or school saying you trained with them."
              capture="environment"
              state={photos.attestation}
              onChange={(e) => choose('attestation', e)}
            />
            <PhotoField
              id="certificate"
              label="Certificate"
              hint="A trade test, freedom, school or professional certificate, if you have one."
              capture="environment"
              state={photos.certificate}
              onChange={(e) => choose('certificate', e)}
            />

            {state.techLinks && (
              <>
                <h2 className="section-title">Your work online (optional)</h2>
                <p className="meta">
                  Helps GADMO check your tech skills. Only GADMO staff see these links; customers
                  never do.
                </p>
                {(
                  [
                    ['linkedin', 'LinkedIn profile', 'linkedin.com/in/your-name'],
                    ['github', 'GitHub profile', 'github.com/your-name'],
                    ['portfolio', 'Portfolio or website', 'your-site.com'],
                  ] as const
                ).map(([key, label, example]) => (
                  <div className="field" key={key}>
                    <label htmlFor={`link-${key}`}>{label}</label>
                    <input
                      id={`link-${key}`}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      maxLength={300}
                      value={links[key]}
                      onChange={(e) => setLinks((l) => ({ ...l, [key]: e.target.value }))}
                      placeholder={example}
                    />
                  </div>
                ))}
              </>
            )}

            <p className="meta">
              Only GADMO staff can see these, to confirm it’s you and your skill. Your NIN is stored
              encrypted and is never shown to customers.
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
