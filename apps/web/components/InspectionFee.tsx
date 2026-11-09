'use client';

import { type FormEvent, useState } from 'react';
import { ApiError, fieldMessage, post } from '@/lib/api';
import type { ChatMessage, Conversation, OfferStatus } from '@/lib/types';
import { VisitPanel } from './Visit';

/** "₦2,500": offers are in whole naira. */
export function naira(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;
}

/** Whole naira typed by a person → kobo, or null if it isn't a usable amount. */
function toKobo(text: string): number | null {
  const n = Number(text.replace(/[₦,\s]/g, ''));
  return Number.isInteger(n) && n > 0 ? n * 100 : null;
}

const MAX_NAIRA = 5000;

function AmountForm({
  label,
  submitLabel,
  withNote,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  withNote: boolean;
  onSubmit: (amountKobo: number, note: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const kobo = toKobo(amount);
    if (kobo === null) {
      setError('Enter an amount in whole naira, e.g. 2000.');
      return;
    }
    if (kobo > MAX_NAIRA * 100) {
      setError('The inspection fee can’t be more than ₦5,000.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(kobo, note.trim());
      setAmount('');
      setNote('');
    } catch (err) {
      setError(
        fieldMessage(err) ?? (err instanceof ApiError ? err.message : 'Not sent. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  const id = submitLabel.toLowerCase().replace(/\W+/g, '-');
  return (
    <form className="fee-form" onSubmit={submit} noValidate>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${id}-amount`}>
          {label} <span className="hint">Up to ₦5,000, in naira.</span>
        </label>
        <input
          id={`${id}-amount`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 2000"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))}
        />
      </div>
      {withNote && (
        <div className="field">
          <label htmlFor={`${id}-note`}>
            Why this amount? <span className="hint">Optional: distance, urgency, the job.</span>
          </label>
          <input
            id={`${id}-note`}
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      )}
      <div className="fee-actions">
        <button className="button button-small" type="submit" disabled={busy}>
          {busy ? 'Sending…' : submitLabel}
        </button>
        {onCancel && (
          <button className="button button-quiet button-small" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** The panel above the chat: what the inspection fee is, or how to agree one. */
export function InspectionPanel({
  convo,
  pending,
  onChanged,
}: {
  convo: Conversation;
  pending: boolean;
  onChanged: () => Promise<void>;
}) {
  const { job, you } = convo;
  if (job.inspectionPolicy === 'NONE') {
    if (job.status !== 'ACCEPTED') return null;
    return (
      <p className="fee-panel">
        No inspection fee for this service.{' '}
        {you === 'PRO' ? 'You quote directly.' : 'Your Pro will quote directly.'}
      </p>
    );
  }
  if (job.inspectionFeeKobo !== null) {
    const fee = naira(job.inspectionFeeKobo);
    if (job.status !== 'ACCEPTED') {
      return <VisitPanel convo={convo} fee={fee} onChanged={onChanged} />;
    }
    if (you === 'PRO') {
      return (
        <p className="fee-panel fee-agreed">
          <strong>Inspection fee agreed: {fee}.</strong> Waiting for the customer to pay it in the
          app. Visit once it’s paid.
        </p>
      );
    }
    return <PayInspectionFee jobId={job.id} fee={fee} />;
  }
  // Quoted without an inspection: nothing more to agree here.
  if (job.status !== 'ACCEPTED') return null;
  if (pending) {
    return <p className="fee-panel">An inspection-fee offer is waiting for an answer below.</p>;
  }
  if (you === 'CUSTOMER') {
    return (
      <p className="fee-panel">
        {job.inspectionPolicy === 'REQUIRED'
          ? 'Your Pro will offer an inspection fee here (up to ₦5,000) before visiting.'
          : 'If your Pro needs to see the job first, they’ll offer an inspection fee here (up to ₦5,000).'}
      </p>
    );
  }
  return (
    <div className="fee-panel">
      <p>
        <strong>Offer an inspection fee</strong>{' '}
        {job.inspectionPolicy === 'REQUIRED'
          ? 'before you visit. Base it on the distance, how urgent it is and the job.'
          : 'if you need to see the job before quoting.'}
      </p>
      <AmountForm
        label="Inspection fee"
        submitLabel="Send offer"
        withNote
        onSubmit={async (amountKobo, note) => {
          await post(`/v1/jobs/${job.id}/inspection-offers`, {
            amountKobo,
            ...(note ? { note } : {}),
          });
          await onChanged();
        }}
      />
    </div>
  );
}

/** The customer pays the agreed fee on the payment page, then comes back to the chat. */
function PayInspectionFee({ jobId, fee }: { jobId: string; fee: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setError(null);
    setBusy(true);
    try {
      const { authorizationUrl } = await post<{ authorizationUrl: string }>(
        `/v1/jobs/${jobId}/inspection-fee/pay`,
      );
      window.location.assign(authorizationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="fee-panel fee-agreed">
      <p>
        <strong>Inspection fee agreed: {fee}.</strong> Pay it in the app before the visit. GADMO
        holds it until your Pro arrives, and it counts toward the final bill.
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <button className="button button-small" type="button" disabled={busy} onClick={pay}>
        {busy ? 'Opening payment…' : `Pay ${fee} now`}
      </button>
    </div>
  );
}

const STATUS_TEXT: Record<OfferStatus, string> = {
  PENDING: 'Waiting for an answer',
  ACCEPTED: 'Accepted',
  COUNTERED: 'Countered',
  DECLINED: 'Declined',
};

/** An offer in the chat, with Accept / Counter / Decline for the person it was sent to. */
export function OfferCard({
  message,
  status,
  canAnswer,
  onChanged,
}: {
  message: ChatMessage;
  status: OfferStatus;
  canAnswer: boolean;
  onChanged: () => Promise<void>;
}) {
  const offer = message.offer!;
  const [countering, setCountering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = status === 'PENDING' && canAnswer;

  async function act(action: 'accept' | 'decline') {
    setError(null);
    setBusy(true);
    try {
      await post(`/v1/inspection-offers/${offer.id}/${action}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`offer-card${message.mine ? ' offer-card-mine' : ''}`}>
      <p className="offer-card-title">
        {message.mine ? 'Your offer' : 'Inspection fee offer'}:{' '}
        <strong>{naira(offer.amountKobo)}</strong>
      </p>
      {offer.note && <p className="offer-card-note">{offer.note}</p>}
      <p className={`offer-card-status offer-${status.toLowerCase()}`}>{STATUS_TEXT[status]}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {open && !countering && (
        <div className="fee-actions">
          <button
            className="button button-small"
            type="button"
            disabled={busy}
            onClick={() => act('accept')}
          >
            Accept {naira(offer.amountKobo)}
          </button>
          <button
            className="button button-quiet button-small"
            type="button"
            disabled={busy}
            onClick={() => setCountering(true)}
          >
            Counter
          </button>
          <button
            className="button button-quiet button-small"
            type="button"
            disabled={busy}
            onClick={() => act('decline')}
          >
            Decline
          </button>
        </div>
      )}
      {open && countering && (
        <AmountForm
          label="Your counter-offer"
          submitLabel="Send counter-offer"
          withNote={false}
          onCancel={() => setCountering(false)}
          onSubmit={async (amountKobo) => {
            await post(`/v1/inspection-offers/${offer.id}/counter`, { amountKobo });
            setCountering(false);
            await onChanged();
          }}
        />
      )}
    </li>
  );
}
