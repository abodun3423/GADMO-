'use client';

import { type FormEvent, useState } from 'react';
import { ApiError, fieldMessage, post } from '@/lib/api';
import { money } from '@/lib/money';
import type { ChatMessage, Conversation, Quote, QuoteStatus } from '@/lib/types';

/** Whole naira typed by a person → kobo (0 for empty), or null if it isn't usable. */
function toKobo(text: string, allowEmpty = false): number | null {
  const clean = text.replace(/[₦,\s]/g, '');
  if (!clean) return allowEmpty ? 0 : null;
  const n = Number(clean);
  return Number.isInteger(n) && n >= 0 ? n * 100 : null;
}

function reason(err: unknown, fallback: string): string {
  return fieldMessage(err) ?? (err instanceof ApiError ? err.message : fallback);
}

/** The inspection fee already paid, which counts toward the quote. */
function feePaid(job: Conversation['job']): number {
  return job.arrivedAt && job.inspectionFeeKobo ? job.inspectionFeeKobo : 0;
}

/** Can the Pro send a quote now? After seeing the job (arrival), or straight away without an inspection. */
export function canQuote(job: Conversation['job']): boolean {
  const visitFirst =
    job.inspectionPolicy === 'REQUIRED' ||
    (job.inspectionPolicy === 'OPTIONAL' && job.inspectionFeeKobo !== null);
  return (
    (job.status === 'ACCEPTED' && !visitFirst) ||
    (job.status === 'INSPECTION_PAID' && job.arrivedAt !== null)
  );
}

/** Below the job panels: the Pro's quote form, or where the quote stands. */
export function QuotePanel({
  convo,
  onChanged,
}: {
  convo: Conversation;
  onChanged: () => Promise<void>;
}) {
  const { job, you } = convo;
  if (job.status === 'QUOTE_ACCEPTED') {
    return (
      <p className="fee-panel fee-agreed">
        <strong>Quote accepted.</strong>{' '}
        {you === 'PRO'
          ? 'Start the work when you’re ready. Any deposit is released to you when you start.'
          : 'Your Pro starts the work next. You pay the balance in GADMO when it’s done.'}
      </p>
    );
  }
  if (job.status === 'QUOTED') {
    return (
      <p className="fee-panel">
        {you === 'PRO'
          ? 'Your quote is waiting for the customer’s answer below.'
          : 'Your Pro sent a quote. Review it below.'}
      </p>
    );
  }
  if (you !== 'PRO' || !canQuote(job)) return null;
  return <QuoteForm jobId={job.id} feeKobo={feePaid(job)} onSent={onChanged} />;
}

function QuoteForm({
  jobId,
  feeKobo,
  onSent,
}: {
  jobId: string;
  feeKobo: number;
  onSent: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [deposit, setDeposit] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountKobo = toKobo(amount);
  const depositKobo = toKobo(deposit, true);
  const balance =
    amountKobo !== null && depositKobo !== null ? amountKobo - feeKobo - depositKobo : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!amountKobo) return setError('Enter the price for the whole job, in naira.');
    if (depositKobo === null)
      return setError('Enter the deposit in whole naira, or leave it empty.');
    if (depositKobo * 2 > amountKobo) return setError('The deposit can be at most half the quote.');
    if (amountKobo < feeKobo) {
      return setError(
        `The quote can’t be less than the ${money(feeKobo)} inspection fee already paid.`,
      );
    }
    if (balance !== null && balance < 0) {
      return setError('The deposit and the inspection fee together can’t be more than the quote.');
    }
    if (description.trim().length < 5) return setError('Say what the price covers.');
    setBusy(true);
    try {
      await post(`/v1/jobs/${jobId}/quotes`, {
        amountKobo,
        depositKobo,
        description: description.trim(),
      });
      setOpen(false);
      setAmount('');
      setDeposit('');
      setDescription('');
      await onSent();
    } catch (err) {
      setError(reason(err, 'Not sent. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="fee-panel">
        <p>
          <strong>Ready to price the job?</strong> Send the customer a quote in the chat.
        </p>
        <button className="button button-small" type="button" onClick={() => setOpen(true)}>
          Send a quote
        </button>
      </div>
    );
  }
  return (
    <form className="fee-panel fee-form" onSubmit={submit} noValidate>
      <p className="panel-title">Your quote</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="field">
        <label htmlFor="quote-amount">
          Price for the whole job (₦)
          <span className="hint">
            Labour and materials.
            {feeKobo > 0 && ` The ${money(feeKobo)} inspection fee already paid counts toward it.`}
          </span>
        </label>
        <input
          id="quote-amount"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 25000"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))}
        />
      </div>
      <div className="field">
        <label htmlFor="quote-deposit">
          Materials deposit (₦, optional)
          <span className="hint">
            Paid in GADMO when the customer accepts; released to you when you start work. At most
            half the price.
          </span>
        </label>
        <input
          id="quote-deposit"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 10000"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value.replace(/[^\d,]/g, ''))}
        />
      </div>
      <div className="field">
        <label htmlFor="quote-description">
          What the price covers
          <span className="hint">The work, the materials, how long it takes.</span>
        </label>
        <textarea
          id="quote-description"
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {amountKobo !== null && balance !== null && balance >= 0 && (
        <p className="meta">
          The customer pays {depositKobo ? `${money(depositKobo)} now, then ` : ''}
          {money(balance)} after the job.
        </p>
      )}
      <div className="fee-actions">
        <button className="button button-small" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send quote'}
        </button>
        <button
          className="button button-quiet button-small"
          type="button"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const STATUS: Record<QuoteStatus, string> = {
  PENDING: 'Waiting for an answer',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

/** A quote in the chat: the price, what's paid when, and the customer's answer. */
export function QuoteCard({
  message,
  quote,
  status,
  convo,
  onChanged,
}: {
  message: ChatMessage;
  quote: Quote;
  status: QuoteStatus;
  convo: Conversation;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customer = convo.you === 'CUSTOMER';
  const fee = feePaid(convo.job);
  const balance = Math.max(0, quote.amountKobo - fee - quote.depositKobo);
  const open = status === 'PENDING' && convo.open;

  async function act(action: 'accept' | 'decline' | 'withdraw') {
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ payment?: { authorizationUrl: string } }>(
        `/v1/quotes/${quote.id}/${action}`,
      );
      if (res.payment) {
        window.location.assign(res.payment.authorizationUrl);
        return;
      }
      await onChanged();
    } catch (err) {
      setError(reason(err, 'Not sent. Try again.'));
    }
    setBusy(false);
  }

  return (
    <li className={`offer-card quote-card${message.mine ? ' offer-card-mine' : ''}`}>
      <p className="offer-card-title">
        {message.mine ? 'Your quote' : 'Quote'}: <strong>{money(quote.amountKobo)}</strong>
      </p>
      <p className="offer-card-note">{quote.description}</p>
      <dl className="quote-lines">
        {fee > 0 && (
          <div>
            <dt>Inspection fee (already paid)</dt>
            <dd>−{money(fee)}</dd>
          </div>
        )}
        {quote.depositKobo > 0 && (
          <div>
            <dt>Materials deposit, paid on accepting</dt>
            <dd>{money(quote.depositKobo)}</dd>
          </div>
        )}
        <div>
          <dt>Balance, paid after the job</dt>
          <dd>{money(balance)}</dd>
        </div>
      </dl>
      <p className={`offer-card-status offer-${status.toLowerCase()}`}>{STATUS[status]}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {open && customer && (
        <div className="fee-actions">
          <button
            className="button button-small"
            type="button"
            disabled={busy}
            onClick={() => act('accept')}
          >
            {quote.depositKobo > 0
              ? `Accept and pay ${money(quote.depositKobo)} deposit`
              : 'Accept quote'}
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
      {open && !customer && (
        <button
          className="button button-quiet button-small"
          type="button"
          disabled={busy}
          onClick={() => act('withdraw')}
        >
          Withdraw quote
        </button>
      )}
    </li>
  );
}
