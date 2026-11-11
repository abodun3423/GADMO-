'use client';

import { useState } from 'react';
import { CASH_AGREEMENT_TEXT, CASH_AGREEMENT_VERSION } from '@gadmo/shared/cash';
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
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [choosingCash, setChoosingCash] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [received, setReceived] = useState('');
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

  async function sendReport() {
    if (reason.trim().length < 10) {
      setError('Tell us what is wrong (at least a few words).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post(`/v1/jobs/${job.id}/report-problem`, { reason });
      setReporting(false);
      setReason('');
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Not sent. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function send(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await post(`/v1/jobs/${job.id}/${path}`, body);
      setChoosingCash(false);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Not saved. Check your connection and try again.',
      );
    } finally {
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
    const cash = job.paymentMethod === 'CASH';
    if (you === 'PRO') {
      if (!cash) {
        return (
          <p className="fee-panel fee-agreed">
            <strong>Job done.</strong> The customer pays the {money(balance)} balance next.
          </p>
        );
      }
      const amount = received === '' ? balance / 100 : Number(received);
      return (
        <div className="fee-panel fee-agreed">
          <p>
            <strong>The customer is paying the {money(balance)} balance in cash.</strong> Confirm
            here once you receive it. GADMO takes no commission on cash.
          </p>
          <div className="field">
            <label htmlFor="cash-received">Cash you received (₦)</label>
            <input
              id="cash-received"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={received === '' ? String(balance / 100) : received}
              onChange={(e) => setReceived(e.target.value)}
            />
          </div>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!(amount > 0) || !Number.isInteger(amount)) {
                setError('Enter the amount in whole naira.');
                return;
              }
              void send('cash/received', { amountKobo: amount * 100 });
            }}
          >
            {busy ? 'Saving…' : 'Confirm cash received'}
          </button>
          {failed}
        </div>
      );
    }
    if (balance === 0) {
      return (
        <p className="fee-panel fee-agreed">
          <strong>Job done.</strong> Check the work. There is nothing more to pay.
        </p>
      );
    }
    if (cash) {
      return (
        <div className="fee-panel fee-agreed">
          <p>
            <strong>Paying {money(balance)} in cash.</strong> Give the cash to your Pro; they
            confirm here when they receive it. GADMO doesn’t hold cash and can’t refund it. Changed
            your mind? You can still pay in the app, where GADMO protects your payment.
          </p>
          <button
            className="button button-quiet"
            type="button"
            disabled={busy}
            onClick={payBalance}
          >
            {busy ? 'Opening payment…' : `Pay ${money(balance)} in the app instead`}
          </button>
          {failed}
        </div>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Job done. Balance to pay: {money(balance)}.</strong> Check the work first. GADMO
          holds your payment for 12 hours before paying your Pro, so you can report a problem.
        </p>
        {choosingCash ? (
          <div className="cash-agreement">
            <p className="alert alert-error">
              <strong>Cash is not protected.</strong> If the work turns out to be faulty, even
              within 12 hours, GADMO can’t refund cash.
            </p>
            <label className="choice">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{CASH_AGREEMENT_TEXT}</span>
            </label>
            <div className="fee-actions">
              <button
                className="button"
                type="button"
                disabled={busy || !agreed}
                onClick={() => send('cash', { accept: true, version: CASH_AGREEMENT_VERSION })}
              >
                {busy ? 'Saving…' : `Pay ${money(balance)} in cash`}
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={busy}
                onClick={() => {
                  setChoosingCash(false);
                  setAgreed(false);
                  setError(null);
                }}
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="fee-actions">
            <button className="button" type="button" disabled={busy} onClick={payBalance}>
              {busy ? 'Opening payment…' : `Pay ${money(balance)}`}
            </button>
            <button
              className="button button-quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setChoosingCash(true);
                setError(null);
              }}
            >
              Pay in cash instead
            </button>
          </div>
        )}
        {failed}
      </div>
    );
  }

  if (job.status === 'CASH_COMPLETED') {
    return (
      <p className="fee-panel fee-agreed">
        <strong>Job complete. Paid in cash.</strong>{' '}
        {you === 'PRO' ? 'Thanks for confirming.' : 'Thank you for using GADMO.'}
      </p>
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
        ) : reporting ? (
          <div className="field">
            <label htmlFor="problem">
              What is wrong with the work?
              <span className="hint">
                GADMO keeps the payment on hold and reviews the chat, the quote and any photos. Add
                photos in the chat if they help.
              </span>
            </label>
            <textarea
              id="problem"
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="fee-actions">
              <button className="button" type="button" disabled={busy} onClick={sendReport}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={busy}
                onClick={() => {
                  setReporting(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="fee-actions">
            <button className="button" type="button" onClick={() => setConfirming(true)}>
              All good: pay my Pro
            </button>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                setReporting(true);
                setError(null);
              }}
            >
              Report a problem
            </button>
          </div>
        )}
        {failed}
      </div>
    );
  }

  if (job.status === 'DISPUTED') {
    return (
      <p className="fee-panel fee-agreed">
        <strong>Problem reported.</strong>{' '}
        {you === 'PRO'
          ? 'The customer reported a problem with the work. GADMO holds the payment while staff review the chat, the quote and the photos. You’ll be told the outcome here.'
          : 'GADMO holds the payment while staff review the chat, the quote and the photos. You’ll be told the outcome here.'}
      </p>
    );
  }

  if (job.status === 'COMPLETED') {
    return (
      <p className="fee-panel fee-agreed">
        <strong>Job complete.</strong>{' '}
        {you === 'PRO' ? 'See your wallet for what GADMO paid you.' : 'Thank you for using GADMO.'}
      </p>
    );
  }

  return null;
}
