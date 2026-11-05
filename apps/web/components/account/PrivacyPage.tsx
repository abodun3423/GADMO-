'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useSession } from '@/lib/useSession';
import { AccountShell } from './AccountShell';
import { SignedOut } from './SignedOut';

const day = new Intl.DateTimeFormat('en-NG', { dateStyle: 'long' });

export function PrivacyPage() {
  const { me, loading } = useSession();
  const [account, setAccount] = useState<Me | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api<{ user: Me }>('/v1/me')
      .then((r) => setAccount(r.user))
      .catch(() => undefined);
  }, [me]);

  async function download() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/v1/me/export', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(res.status === 429 ? 'limit' : 'failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gadmo-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'limit'
          ? 'You can download your data 5 times a day. Try again tomorrow.'
          : 'Your data could not be downloaded. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deletion(ask: boolean) {
    setError(null);
    setBusy(true);
    try {
      const r = ask
        ? await post<{ user: Me }>('/v1/me/deletion-request', reason.trim() ? { reason } : {})
        : await api<{ user: Me }>('/v1/me/deletion-request', { method: 'DELETE' });
      setAccount(r.user);
      setConfirming(false);
      setReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) return <SignedOut next="/account/privacy" title="Privacy & security" />;
  const pro = me.role === 'PRO';
  const other = pro ? 'customers' : 'Pros';

  return (
    <AccountShell>
      <h1 className="page-title">Privacy & security</h1>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <h2 className="panel-title">What others can see</h2>
        <ul className="ticks">
          <li>
            Your <strong>name</strong>
            {pro ? ', skills, rating and verified badge' : ''}.
          </li>
          <li>
            <strong>Never</strong> your phone number or email. You talk, call and pay inside GADMO.
          </li>
          {pro ? (
            <li>Your exact base is never shown; customers see roughly how far away you are.</li>
          ) : (
            <li>
              Your exact location only after you pay the inspection fee, or when you share a pin in
              the chat.
            </li>
          )}
          <li>
            Phone numbers, emails and links typed in the chat are hidden automatically, for you and
            for {other}.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">How GADMO protects your data</h2>
        <ul className="ticks">
          <li>Everything you send travels encrypted.</li>
          {pro && (
            <li>
              Your NIN, ID photo and selfie are stored encrypted and seen only by GADMO staff who
              check identities.
            </li>
          )}
          <li>Chat photos and voice notes are stored encrypted, for the two people on the job.</li>
          <li>Card payments happen on Paystack; GADMO never sees or stores your card.</li>
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">Your data</h2>
        <p className="meta">
          Under the Nigeria Data Protection Act you can get a copy of your data at any time.
        </p>
        <button
          className="button button-quiet button-small"
          type="button"
          disabled={busy}
          onClick={download}
        >
          Download my data
        </button>
      </section>

      <section className="panel panel-danger">
        <h2 className="panel-title">Delete my account</h2>
        {account?.deletionRequestedAt ? (
          <>
            <p className="alert alert-info" role="status">
              You asked us to delete your account on{' '}
              {day.format(new Date(account.deletionRequestedAt))}. GADMO first settles any open jobs
              and money, then deletes it. You can change your mind until then.
            </p>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={busy}
              onClick={() => deletion(false)}
            >
              Keep my account
            </button>
          </>
        ) : confirming ? (
          <>
            <p className="meta">
              We’ll settle any open jobs and{' '}
              {pro ? 'pay out your remaining earnings' : 'refund anything we hold for you'}, then
              delete your account and personal data. Records the law requires (such as payments) are
              kept for as long as required.
            </p>
            <div className="field">
              <label htmlFor="reason">
                Why are you leaving? <span className="hint">Optional. It helps us improve.</span>
              </label>
              <textarea
                id="reason"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <div className="fee-actions">
              <button
                className="button button-small button-danger"
                type="button"
                disabled={busy}
                onClick={() => deletion(true)}
              >
                Ask GADMO to delete my account
              </button>
              <button
                className="button button-quiet button-small"
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="meta">Close your GADMO account and remove your personal data.</p>
            <button
              className="button button-quiet button-small"
              type="button"
              onClick={() => setConfirming(true)}
            >
              Delete my account…
            </button>
          </>
        )}
      </section>
    </AccountShell>
  );
}
