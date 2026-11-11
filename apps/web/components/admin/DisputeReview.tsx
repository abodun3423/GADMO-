'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post } from '@/lib/api';
import { money } from '@/lib/money';
import type { DisputeDetail } from '@/lib/types';
import { DISPUTE_LABEL } from './DisputeList';
import { StaffOnly } from './StaffOnly';

type Outcome = 'PAY_PRO' | 'REFUND' | 'SPLIT' | 'SEND_BACK';

const timeFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

const FROM: Record<DisputeDetail['messages'][number]['from'], string> = {
  CUSTOMER: 'Customer',
  PRO: 'Pro',
  GADMO: 'GADMO',
};

export function DisputeReview({ id }: { id: string }) {
  return (
    <StaffOnly next={`/admin/disputes/${id}`}>
      <Review id={id} />
    </StaffOnly>
  );
}

function Review({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<DisputeDetail | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [share, setShare] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ dispute: DisputeDetail }>(`/v1/admin/disputes/${id}`)
      .then((r) => setD(r.dispute))
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This report does not exist.'
            : 'This report could not be loaded. Check your connection and refresh.',
        ),
      );
  }, [id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!outcome) {
      setError('Choose what GADMO does.');
      return;
    }
    const shareKobo = Math.round(Number(share) * 100);
    if (outcome === 'SPLIT' && !(shareKobo > 0)) {
      setError('Enter the Pro’s share in naira.');
      return;
    }
    if (note.trim().length < 5) {
      setError('Explain the decision (at least a few words). Both sides see it.');
      return;
    }
    setBusy(true);
    try {
      await post(`/v1/admin/disputes/${id}/resolve`, {
        outcome,
        note,
        ...(outcome === 'SPLIT' ? { proShareKobo: shareKobo } : {}),
      });
      router.push(`/admin/disputes?done=${outcome}`);
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
        <Link href="/admin/disputes">← All reports</Link>
      </p>
      <h1 className="page-title">{d ? `${d.serviceName}: problem reported` : 'Report'}</h1>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!d && !error && <p className="meta">Loading…</p>}

      {d && (
        <>
          <dl className="details">
            <div>
              <dt>What the customer says</dt>
              <dd>“{d.reason}”</dd>
            </div>
            <div>
              <dt>Customer · Pro</dt>
              <dd>
                {d.customerName ?? 'No name'} · {d.proName ?? 'No name'}
              </dd>
            </div>
            <div>
              <dt>The job</dt>
              <dd>{d.description}</dd>
            </div>
            <div>
              <dt>Money</dt>
              <dd>
                {d.quote
                  ? `Quote ${money(d.quote.amountKobo)}, deposit ${money(d.quote.depositKobo)} (already with the Pro)`
                  : 'No accepted quote'}
                {d.inspectionFeeKobo !== null && (
                  <span className="hint">Inspection fee {money(d.inspectionFeeKobo)}, paid</span>
                )}
                <span className="hint">
                  <strong>Held by GADMO now: {money(d.heldKobo)}</strong>
                </span>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {DISPUTE_LABEL[d.status]}
                {d.resolution && <span className="hint">Decision: {d.resolution}</span>}
              </dd>
            </div>
          </dl>

          <h2 className="section-title">The chat</h2>
          <ol className="dispute-chat">
            {d.messages.map((m) => (
              <li key={m.id} className={m.kind === 'EVENT' ? 'chat-event' : 'dispute-msg'}>
                {m.kind !== 'EVENT' && <strong>{FROM[m.from]}: </strong>}
                {m.kind === 'PHOTO' && m.fileId ? (
                  <img
                    className="photo-preview"
                    src={`/v1/admin/disputes/${id}/files/${m.fileId}`}
                    alt={`Photo from the ${FROM[m.from].toLowerCase()}`}
                  />
                ) : m.kind === 'VOICE' && m.fileId ? (
                  <audio
                    controls
                    preload="none"
                    src={`/v1/admin/disputes/${id}/files/${m.fileId}`}
                  />
                ) : (
                  m.body
                )}{' '}
                <span className="chat-event-time">{timeFormat.format(new Date(m.createdAt))}</span>
              </li>
            ))}
          </ol>

          {d.status === 'OPEN' && (
            <form onSubmit={submit} noValidate className="decision">
              <fieldset className="fieldset">
                <legend className="legend">What GADMO does</legend>
                {(
                  [
                    [
                      'PAY_PRO',
                      'Pay the Pro',
                      `The work is fine. The Pro gets the ${money(d.heldKobo)} held, less 10% of the quote.`,
                    ],
                    [
                      'REFUND',
                      'Refund the customer',
                      `The work was not done. ${money(d.heldKobo)} goes to the customer’s GADMO wallet. No commission.`,
                    ],
                    [
                      'SPLIT',
                      'Split it',
                      'Part of the work was done. Choose the Pro’s share; 10% of it is commission; the rest is refunded.',
                    ],
                    [
                      'SEND_BACK',
                      'Send the Pro back to fix it',
                      'The payment stays on hold. When the Pro marks the job done again, the customer gets a new 12 hours.',
                    ],
                  ] as const
                ).map(([value, title, text]) => (
                  <label key={value} className="choice">
                    <input
                      type="radio"
                      name="outcome"
                      value={value}
                      checked={outcome === value}
                      onChange={() => setOutcome(value)}
                    />
                    <span>
                      <strong>{title}</strong>
                      {text}
                    </span>
                  </label>
                ))}
              </fieldset>
              {outcome === 'SPLIT' && (
                <div className="field">
                  <label htmlFor="share">
                    The Pro’s share (₦)
                    <span className="hint">Less than {money(d.heldKobo)}.</span>
                  </label>
                  <input
                    id="share"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={share}
                    onChange={(e) => setShare(e.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="resolution">
                  Your decision, explained
                  <span className="hint">Both the customer and the Pro see this in the chat.</span>
                </label>
                <textarea
                  id="resolution"
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
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
