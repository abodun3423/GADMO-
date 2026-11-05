'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post } from '@/lib/api';
import { localPhone } from '@/lib/format';
import type { AccountStatus, AdminUserDetail } from '@/lib/types';
import { useSession } from '@/lib/useSession';
import { AdminNav } from './AdminNav';
import { JobRow } from './JobsList';
import { ACCOUNT_STATUS_LABEL, CHECK_LABEL, dateTime, ROLE_LABEL } from './labels';
import { StaffOnly } from './StaffOnly';

export function UserDetail({ id }: { id: string }) {
  return (
    <StaffOnly next={`/admin/users/${id}`}>
      <Detail id={id} />
    </StaffOnly>
  );
}

const ACTIONS: { to: AccountStatus; label: string; hint: string }[] = [
  { to: 'SUSPENDED', label: 'Suspend', hint: 'Signed out now; can be reactivated later.' },
  { to: 'BANNED', label: 'Ban', hint: 'For fraud or abuse. Signed out now.' },
  { to: 'ACTIVE', label: 'Reactivate', hint: 'They can sign in again.' },
];

function Detail({ id }: { id: string }) {
  const { me } = useSession();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<AccountStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUser((await api<{ user: AdminUserDetail }>(`/v1/admin/users/${id}`)).user);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'This account does not exist.'
          : 'This account could not be loaded. Check your connection and refresh.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(e: FormEvent) {
    e.preventDefault();
    if (!action) return;
    setError(null);
    setNotice(null);
    if (reason.trim().length < 5) {
      setError('Give a short reason (it goes in the audit log).');
      return;
    }
    setBusy(true);
    try {
      await post(`/v1/admin/users/${id}/status`, { status: action, reason });
      setNotice(`Account ${ACCOUNT_STATUS_LABEL[action].toLowerCase()}.`);
      setAction(null);
      setReason('');
      await load();
    } catch (err) {
      setError(fieldMessage(err) ?? (err instanceof ApiError ? err.message : 'Not saved.'));
    } finally {
      setBusy(false);
    }
  }

  const self = me?.id === id;

  return (
    <>
      <AdminNav />
      <p className="meta">
        <Link href="/admin/users">← All users</Link>
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-info" role="status">
          {notice}
        </p>
      )}
      {!user && !error && <p className="meta">Loading…</p>}
      {user && (
        <>
          <h1 className="page-title">{user.name ?? 'No name yet'}</h1>
          <p className="lede">
            {ROLE_LABEL[user.role]} · {ACCOUNT_STATUS_LABEL[user.status]}
          </p>

          <dl className="details">
            <div>
              <dt>Phone</dt>
              <dd>{localPhone(user.phone)}</dd>
            </div>
            {user.email && (
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
            )}
            <div>
              <dt>Joined</dt>
              <dd>{dateTime.format(new Date(user.createdAt))}</dd>
            </div>
            <div>
              <dt>Contact-sharing attempts in chat</dt>
              <dd>{user.chatFlags}</dd>
            </div>
            {user.pro && (
              <>
                <div>
                  <dt>Identity</dt>
                  <dd>
                    {CHECK_LABEL[user.pro.verificationStatus]}
                    {user.latestCheck && (
                      <>
                        {' · '}
                        <Link href={`/admin/verifications/${user.latestCheck.id}`}>
                          Open the identity check
                        </Link>
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Skills</dt>
                  <dd>{user.skills.length ? user.skills.join(', ') : 'None yet'}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    {user.pro.isOnline ? 'Online' : 'Offline'} · travels up to{' '}
                    {user.pro.serviceRadiusKm} km · rating{' '}
                    {user.pro.ratingCount ? user.pro.ratingAvg.toFixed(1) : 'none yet'}
                  </dd>
                </div>
                {user.pro.bio && (
                  <div>
                    <dt>About</dt>
                    <dd>{user.pro.bio}</dd>
                  </div>
                )}
              </>
            )}
          </dl>

          {!self && (
            <section className="account-actions" aria-labelledby="actions-title">
              <h2 id="actions-title" className="section-title">
                Account
              </h2>
              <div className="fee-actions">
                {ACTIONS.filter((a) => a.to !== user.status).map((a) => (
                  <button
                    key={a.to}
                    type="button"
                    className={`button button-small${a.to === 'ACTIVE' ? '' : ' button-quiet'}`}
                    aria-pressed={action === a.to}
                    onClick={() => setAction(a.to)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {action && (
                <form onSubmit={change} noValidate className="fee-form">
                  <div className="field">
                    <label htmlFor="reason">
                      Reason{' '}
                      <span className="hint">
                        {ACTIONS.find((a) => a.to === action)?.hint} Kept in the audit log.
                      </span>
                    </label>
                    <input
                      id="reason"
                      type="text"
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <button className="button button-small" type="submit" disabled={busy}>
                    {busy ? 'Saving…' : `Confirm: ${ACTIONS.find((a) => a.to === action)?.label}`}
                  </button>
                </form>
              )}
              {user.statusHistory.length > 0 && (
                <ul className="history">
                  {user.statusHistory.map((h, i) => (
                    <li key={i} className="hint">
                      {dateTime.format(new Date(h.createdAt))}: {h.metadata?.from} →{' '}
                      {h.metadata?.to}. {h.metadata?.reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <h2 className="section-title">Recent jobs</h2>
          {user.recentJobs.length === 0 ? (
            <p className="empty">No jobs yet.</p>
          ) : (
            <ul className="admin-jobs">
              {user.recentJobs.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
