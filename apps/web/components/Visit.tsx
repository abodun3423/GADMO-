'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post } from '@/lib/api';
import type { Conversation } from '@/lib/types';

/**
 * After the inspection fee is paid: the customer sees their arrival code; the Pro taps
 * "On my way" and, on arrival, enters the code the customer gives them. The code releases
 * the held fee to the Pro.
 */
export function VisitPanel({
  convo,
  fee,
  onChanged,
}: {
  convo: Conversation;
  fee: string;
  onChanged: () => Promise<void>;
}) {
  const { job, you } = convo;

  if (job.arrivedAt) {
    return (
      <p className="fee-panel fee-agreed">
        <strong>{you === 'PRO' ? 'Arrival confirmed.' : 'Your Pro has arrived.'}</strong>{' '}
        {you === 'PRO'
          ? `The inspection fee of ${fee} is now yours, in your GADMO earnings.`
          : `The inspection fee of ${fee} has been paid to them. It counts toward the final bill.`}
      </p>
    );
  }
  return you === 'CUSTOMER' ? (
    <CustomerCode convo={convo} fee={fee} />
  ) : (
    <ProVisit convo={convo} fee={fee} onChanged={onChanged} />
  );
}

function CustomerCode({ convo, fee }: { convo: Conversation; fee: string }) {
  const [code, setCode] = useState(convo.job.arrivalCode);
  // Paid while this chat was open: fetch the new code once.
  useEffect(() => {
    if (code) return;
    api<{ conversation: Conversation }>(`/v1/jobs/${convo.job.id}/conversation`)
      .then((r) => setCode(r.conversation.job.arrivalCode))
      .catch(() => undefined);
  }, [code, convo.job.id]);

  return (
    <div className="fee-panel fee-agreed">
      <p>
        <strong>Inspection fee paid: {fee}.</strong> GADMO holds it until your Pro arrives.
        {convo.job.onTheWayAt && ' Your Pro is on the way.'}
      </p>
      <p className="arrival-label">Your arrival code</p>
      <p className="arrival-code" aria-label="Your arrival code">
        {code ?? '····'}
      </p>
      <p className="meta">
        Give this code to your Pro only when they are with you. It confirms they arrived and
        releases the fee to them. Never share it in the chat or before they arrive.
      </p>
    </div>
  );
}

function ProVisit({
  convo,
  fee,
  onChanged,
}: {
  convo: Conversation;
  fee: string;
  onChanged: () => Promise<void>;
}) {
  const { job } = convo;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(
        fieldMessage(err) ?? (err instanceof ApiError ? err.message : 'Not sent. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) {
      setError('Enter the 4-digit code the customer gives you.');
      return;
    }
    await run(() => post(`/v1/jobs/${job.id}/arrived`, { code }));
  }

  return (
    <div className="fee-panel fee-agreed">
      <p>
        <strong>The customer has paid the inspection fee ({fee}).</strong> GADMO releases it to you
        when you arrive and enter the customer’s arrival code.
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!job.onTheWayAt ? (
        <button
          className="button button-small"
          type="button"
          disabled={busy}
          onClick={() => run(() => post(`/v1/jobs/${job.id}/on-the-way`))}
        >
          I’m on my way
        </button>
      ) : (
        <form onSubmit={confirm} noValidate>
          <div className="field">
            <label htmlFor="arrival-code">
              Arrived? Enter the customer’s arrival code
              <span className="hint">Ask the customer for the 4 digits in their GADMO chat.</span>
            </label>
            <input
              id="arrival-code"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button className="button button-small" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Confirm arrival'}
          </button>
        </form>
      )}
    </div>
  );
}
