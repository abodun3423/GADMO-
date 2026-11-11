'use client';

import { useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { money } from '@/lib/money';
import type { Conversation } from '@/lib/types';

const releaseFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/**
 * The work after a quote is accepted: the Pro starts it (which pays them any materials
 * deposit) and marks it done. The customer then pays the balance in the app; GADMO holds it
 * for 12 hours (or until the customer confirms the work is good), then pays the Pro.
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

  async function payBalance() {
    setBusy(true);
    setError(null);
    try {
      const { authorizationUrl } = await post<{ authorizationUrl: string }>(
        `/v1/jobs/${job.id}/balance/pay`,
      );
      window.location.assign(authorizationUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment. Try again.');
      setBusy(false);
    }
  }

  async function step(path: 'start-work' | 'work-done' | 'confirm') {
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
    if (you === 'PRO' || balance === 0) {
      return (
        <p className="fee-panel fee-agreed">
          <strong>Job done.</strong>{' '}
          {you === 'PRO'
            ? `The customer pays the ${money(balance)} balance next.`
            : 'Check the work. There is nothing more to pay.'}
        </p>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Job done. Balance to pay: {money(balance)}.</strong> Check the work first. GADMO
          holds your payment for 12 hours before paying your Pro, so you can report a problem.
        </p>
        <button className="button" type="button" disabled={busy} onClick={payBalance}>
          {busy ? 'Opening payment…' : `Pay ${money(balance)}`}
        </button>
        {failed}
      </div>
    );
  }

  if (job.status === 'BALANCE_HELD') {
    const until = job.releaseAt ? releaseFormat.format(new Date(job.releaseAt)) : null;
    if (you === 'PRO') {
      return (
        <p className="fee-panel fee-agreed">
          <strong>Payment held by GADMO.</strong> It goes into your wallet
          {until ? ` by ${until}` : ' within 12 hours'}, less GADMO’s 10% commission, unless the
          customer reports a problem. It can arrive sooner if they confirm the work is good.
        </p>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>GADMO is holding the payment.</strong> Your Pro is paid
          {until ? ` at ${until}` : ' in 12 hours'} unless you report a problem with the work.
          {confirming ? ' Pay your Pro now? This can’t be undone.' : ' Happy with the job?'}
        </p>
        {confirming ? (
          <div className="fee-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => step('confirm')}
            >
              {busy ? 'Paying…' : 'Yes, pay my Pro now'}
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
            All good: pay my Pro
          </button>
        )}
        {failed}
      </div>
    );
  }

  if (job.status === 'COMPLETED') {
    return (
      <p className="fee-panel fee-agreed">
        <strong>Job complete.</strong>{' '}
        {you === 'PRO'
          ? 'GADMO has paid you. See it in your wallet.'
          : 'Your Pro has been paid. Thank you for using GADMO.'}
      </p>
    );
  }

  return null;
}
