'use client';

import { useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { money } from '@/lib/money';
import type { Conversation } from '@/lib/types';

/**
 * The work after a quote is accepted: the Pro starts it (which pays them any materials
 * deposit) and marks it done; the customer sees where it stands and the balance due.
 */
export function WorkPanel({
  convo,
  onChanged,
}: {
  convo: Conversation;
  onChanged: () => Promise<void>;
}) {
  const { job, you } = convo;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function step(path: 'start-work' | 'work-done') {
    setBusy(true);
    setError(null);
    try {
      await post(`/v1/jobs/${job.id}/${path}`);
      setConfirming(false);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Not saved. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const failed = error && (
    <p className="alert alert-error" role="alert">
      {error}
    </p>
  );
  const balance = job.balanceKobo ?? 0;

  if (job.status === 'QUOTE_ACCEPTED') {
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Quote accepted.</strong>{' '}
          {you === 'PRO'
            ? 'Tap “Start work” when you begin, so the customer can follow along.'
            : 'Your Pro starts the work next. You pay the balance in GADMO when it’s done.'}
        </p>
        {you === 'PRO' && (
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => step('start-work')}
          >
            {busy ? 'Starting…' : 'Start work'}
          </button>
        )}
        {failed}
      </div>
    );
  }

  if (job.status === 'IN_PROGRESS') {
    if (you !== 'PRO') {
      return (
        <p className="fee-panel fee-agreed">
          <strong>Work in progress.</strong> Your Pro marks the job done when it’s finished. Check
          the work before you pay the balance.
        </p>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Work in progress.</strong>{' '}
          {confirming
            ? `Is all the work finished? The customer is then asked to pay the ${money(balance)} balance.`
            : 'Tap “Job done” when all the work is finished.'}
        </p>
        {confirming ? (
          <div className="fee-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => step('work-done')}
            >
              {busy ? 'Saving…' : 'Yes, the job is done'}
            </button>
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Not yet
            </button>
          </div>
        ) : (
          <button className="button" type="button" onClick={() => setConfirming(true)}>
            Job done
          </button>
        )}
        {failed}
      </div>
    );
  }

  if (job.status === 'DONE_AWAITING_PAYMENT') {
    return (
      <p className="fee-panel fee-agreed">
        <strong>Job done.</strong>{' '}
        {you === 'PRO'
          ? balance > 0
            ? `The customer pays the ${money(balance)} balance next.`
            : 'There is no balance left to pay.'
          : balance > 0
            ? `Check the work. Balance to pay: ${money(balance)}.`
            : 'Check the work. There is nothing more to pay.'}
      </p>
    );
  }

  return null;
}
