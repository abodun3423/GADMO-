'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { money } from '@/lib/money';
import type { Conversation } from '@/lib/types';
import { RateJob } from './RateJob';

const releaseFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/**
 * The work after a quote is accepted and paid in full (the deposit went to the Pro; GADMO
 * holds the rest). The Pro starts the work and marks it done. The customer is then asked
 * whether they are satisfied: they can release the payment at once, or GADMO releases it
 * automatically 12 hours after "Job done" unless they report a problem (founder decision).
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
  const [error, setError] = useState<string | null>(null);
  const satisfied = useRef<HTMLDialogElement>(null);
  const askSatisfied = job.status === 'BALANCE_HELD' && you !== 'PRO';

  // Once the Pro marks the job done, ask the customer straight away whether they are
  // satisfied (once per job in this browser session; the panel keeps the same choices).
  useEffect(() => {
    if (!askSatisfied) return;
    const key = `gadmo-asked-satisfied-${job.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Storage unavailable: ask anyway.
    }
    const dialog = satisfied.current;
    if (dialog && !dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
  }, [askSatisfied, job.id]);

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

  const reportForm = (
    <div className="field">
      <label htmlFor="problem">
        What is wrong?
        <span className="hint">
          GADMO keeps your payment on hold and reviews the chat, the quote and any photos. Add
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
  );
  const reportButton = (
    <button
      className="button button-quiet button-small"
      type="button"
      onClick={() => {
        setReporting(true);
        setError(null);
      }}
    >
      Report a problem
    </button>
  );

  if (job.status === 'QUOTE_ACCEPTED') {
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Quote accepted.</strong>{' '}
          {you === 'PRO'
            ? 'Tap “Start work” when you begin, so the customer can follow along. GADMO holds the rest of the payment and pays you after the job.'
            : 'You’ve paid, and GADMO holds the balance until the job is done. Your Pro starts the work next.'}
        </p>
        {you !== 'PRO' && (reporting ? reportForm : reportButton)}
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
        <div className="fee-panel fee-agreed">
          <p>
            <strong>Work in progress.</strong> Your Pro marks the job done when it’s finished. GADMO
            holds your payment until you’re satisfied with the work.
          </p>
          {reporting ? reportForm : reportButton}
          {failed}
        </div>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Work in progress.</strong>{' '}
          {confirming
            ? `Is all the work finished? The customer is then asked if they’re satisfied. GADMO pays you the ${money(balance)} balance when they release it, or automatically after 12 hours unless they report a problem.`
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
            ? `The customer pays the ${money(balance)} balance in the app next. GADMO holds it for 12 hours, then pays you.`
            : 'Check the work. There is nothing more to pay.'}
        </p>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Job done. Balance to pay: {money(balance)}.</strong> Check the work first. GADMO
          holds your payment for 12 hours before paying your Pro, so you can report a problem.
          Always pay through GADMO, never in cash, so your money stays protected.
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
          <strong>Payment held by GADMO.</strong> The customer is asked if they’re satisfied. It
          goes into your wallet as soon as they release it, or automatically
          {until ? ` at ${until}` : ' within 12 hours'} unless they report a problem, less GADMO’s
          10% commission.
        </p>
      );
    }
    return (
      <div className="fee-panel fee-agreed">
        <dialog
          ref={satisfied}
          className="satisfied-dialog"
          aria-labelledby="satisfied-title"
          onClose={() => setError(null)}
        >
          <h2 id="satisfied-title">Are you satisfied with the work?</h2>
          <p>
            Your Pro marked the job done. GADMO is holding {money(balance)} for them until you’re
            satisfied.
          </p>
          <p className="meta">
            If you do nothing and don’t report a problem, GADMO releases it automatically
            {until ? ` at ${until}` : ' in 12 hours'}.
          </p>
          <div className="satisfied-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                satisfied.current?.close();
                void step('confirm');
              }}
            >
              Yes, release {money(balance)} to my Pro
            </button>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                satisfied.current?.close();
                setReporting(true);
              }}
            >
              Report a problem
            </button>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => satisfied.current?.close()}
            >
              Not now
            </button>
          </div>
        </dialog>
        <p>
          <strong>Are you satisfied with the work?</strong> GADMO is holding {money(balance)} for
          your Pro. It is released automatically{until ? ` at ${until}` : ' in 12 hours'} unless you
          report a problem.
          {confirming ? ' Release it now? This can’t be undone.' : ''}
        </p>
        {confirming ? (
          <div className="fee-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => step('confirm')}
            >
              {busy ? 'Releasing…' : 'Yes, release it now'}
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
          reportForm
        ) : (
          <div className="fee-actions">
            <button className="button" type="button" onClick={() => setConfirming(true)}>
              I’m satisfied: release payment
            </button>
            {reportButton}
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
      <div className="fee-panel fee-agreed">
        <p>
          <strong>Job complete.</strong>{' '}
          {you === 'PRO'
            ? 'See your wallet for what GADMO paid you.'
            : 'Thank you for using GADMO.'}
        </p>
        <RateJob jobId={job.id} />
      </div>
    );
  }

  return null;
}
