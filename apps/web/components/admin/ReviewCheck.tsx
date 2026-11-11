'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post } from '@/lib/api';
import { localPhone } from '@/lib/format';
import type { ReviewDetail, ReviewResult } from '@/lib/types';
import { StaffOnly } from './StaffOnly';

type Decision = Exclude<ReviewResult, 'PENDING'>;

const RESULT_TEXT: Record<ReviewResult, string> = {
  PENDING: 'Waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  NEEDS_INFO: 'Sent back for more information',
};

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function ReviewCheck({ id }: { id: string }) {
  return (
    <StaffOnly next={`/admin/verifications/${id}`}>
      <Check id={id} />
    </StaffOnly>
  );
}

function Check({ id }: { id: string }) {
  const router = useRouter();
  const [check, setCheck] = useState<ReviewDetail | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ verification: ReviewDetail }>(`/v1/admin/verifications/${id}`)
      .then((r) => setCheck(r.verification))
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This check does not exist.'
            : 'This check could not be loaded. Check your connection and refresh.',
        ),
      );
  }, [id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!decision) {
      setError('Choose approve, ask for more, or reject.');
      return;
    }
    if (decision !== 'APPROVED' && note.trim().length < 5) {
      setError('Tell the Pro what to fix (at least a few words).');
      return;
    }
    setBusy(true);
    try {
      await post(`/v1/admin/verifications/${id}/decision`, {
        decision,
        ...(note.trim() ? { note } : {}),
      });
      router.push(`/admin/checks?done=${decision}`);
    } catch (err) {
      setError(
        fieldMessage(err) ?? (err instanceof ApiError ? err.message : 'Could not save. Try again.'),
      );
      setBusy(false);
    }
  }

  return (
    <>
      <p className="meta">
        <Link href="/admin/checks">← All checks</Link>
      </p>
      <h1 className="page-title">{check?.proName ?? (check ? 'No name yet' : 'Identity check')}</h1>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!check && !error && <p className="meta">Loading…</p>}

      {check && (
        <>
          {check.ninUsedElsewhere > 0 && (
            <p className="alert alert-error">
              This NIN was also sent from {check.ninUsedElsewhere} other Pro{' '}
              {check.ninUsedElsewhere === 1 ? 'account' : 'accounts'}. Check carefully before
              approving.
            </p>
          )}

          <div className="review-grid">
            <figure className="review-photo">
              <img src={`/v1/admin/verifications/${id}/photos/id-document`} alt="ID photo" />
              <figcaption>ID photo</figcaption>
            </figure>
            <figure className="review-photo">
              <img src={`/v1/admin/verifications/${id}/photos/selfie`} alt="Selfie" />
              <figcaption>Selfie</figcaption>
            </figure>
            {check.documents.attestation && (
              <figure className="review-photo">
                <img
                  src={`/v1/admin/verifications/${id}/photos/attestation`}
                  alt="Attestation letter"
                />
                <figcaption>Attestation letter</figcaption>
              </figure>
            )}
            {check.documents.certificate && (
              <figure className="review-photo">
                <img src={`/v1/admin/verifications/${id}/photos/certificate`} alt="Certificate" />
                <figcaption>Certificate</figcaption>
              </figure>
            )}
          </div>

          <dl className="details">
            <div>
              <dt>NIN</dt>
              <dd className="nin">{check.nin ?? 'Not given'}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{localPhone(check.proPhone)}</dd>
            </div>
            <div>
              <dt>Skills</dt>
              <dd>{check.skills.length ? check.skills.join(', ') : 'None yet'}</dd>
            </div>
            <div>
              <dt>Learned at</dt>
              <dd>{check.trainedAt ?? 'Not given'}</dd>
            </div>
            <div>
              <dt>Trained by</dt>
              <dd>
                {check.trainedBy ?? 'Not given'}
                {check.trainerPhone && (
                  <span className="hint">
                    Call to confirm:{' '}
                    <a href={`tel:${check.trainerPhone}`}>{localPhone(check.trainerPhone)}</a>
                  </span>
                )}
              </dd>
            </div>
            {check.techLinks && (
              <div>
                <dt>Work online</dt>
                <dd>
                  {(
                    [
                      ['linkedin', 'LinkedIn'],
                      ['github', 'GitHub'],
                      ['portfolio', 'Portfolio'],
                    ] as const
                  ).map(([key, label]) =>
                    check.techLinks?.[key] ? (
                      <span key={key} className="hint">
                        {label}:{' '}
                        <a
                          href={check.techLinks[key]}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          {check.techLinks[key]}
                        </a>
                      </span>
                    ) : null,
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>Joined GADMO</dt>
              <dd>{dateFormat.format(new Date(check.proJoinedAt))}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {RESULT_TEXT[check.result]}
                {check.reviewNote && <span className="hint">Note: {check.reviewNote}</span>}
              </dd>
            </div>
            {check.history.length > 0 && (
              <div>
                <dt>Earlier checks</dt>
                <dd>
                  {check.history.map((h) => (
                    <span key={h.id} className="hint">
                      {dateFormat.format(new Date(h.createdAt))}: {RESULT_TEXT[h.result]}
                      {h.reviewNote ? `. “${h.reviewNote}”` : ''}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {check.result === 'PENDING' && (
            <form onSubmit={submit} noValidate className="decision">
              <fieldset className="fieldset">
                <legend className="legend">Your decision</legend>
                {(
                  [
                    [
                      'APPROVED',
                      'Approve',
                      'The selfie matches the ID, the letter or certificate looks genuine, and the trainer confirmed.',
                    ],
                    ['NEEDS_INFO', 'Ask for more', 'A photo is unclear or something is missing.'],
                    ['REJECTED', 'Reject', 'It is not the same person, or the ID looks fake.'],
                  ] as const
                ).map(([value, title, text]) => (
                  <label key={value} className="choice">
                    <input
                      type="radio"
                      name="decision"
                      value={value}
                      checked={decision === value}
                      onChange={() => setDecision(value)}
                    />
                    <span>
                      <strong>{title}</strong>
                      {text}
                    </span>
                  </label>
                ))}
              </fieldset>
              {decision && decision !== 'APPROVED' && (
                <div className="field">
                  <label htmlFor="note">
                    Note to the Pro
                    <span className="hint">They see this. Say exactly what to fix.</span>
                  </label>
                  <textarea
                    id="note"
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. The ID photo is blurred. Please retake it in good light."
                  />
                </div>
              )}
              <button className="button" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save decision'}
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
}
