'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, patch } from '@/lib/api';
import { localPhone } from '@/lib/format';
import type { Me } from '@/lib/types';
import { loadMe, useSession } from '@/lib/useSession';
import { AccountShell, initials } from './AccountShell';
import { SignedOut } from './SignedOut';

const since = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric' });

export function ProfilePage() {
  const { me, loading } = useSession();
  const [account, setAccount] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!me) return;
    setName(me.name ?? '');
    api<{ user: Me }>('/v1/me')
      .then((r) => setAccount(r.user))
      .catch(() => undefined);
  }, [me]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const r = await patch<{ user: Me }>('/v1/me', { name });
      setAccount(r.user);
      await loadMe(true);
      setSaved(true);
    } catch (err) {
      setError(
        fieldMessage(err) ??
          (err instanceof ApiError ? err.message : 'Could not save. Check your connection.'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) return <SignedOut next="/account/profile" title="Profile" />;
  const pro = me.role === 'PRO';

  return (
    <AccountShell>
      <h1 className="page-title">Profile</h1>
      <div className="profile-card">
        <span className="avatar avatar-large" aria-hidden="true">
          {initials(me.name)}
        </span>
        <div>
          <strong>{me.name ?? 'No name yet'}</strong>
          <span className="meta">
            {pro ? 'GADMO Pro' : 'Customer'}
            {account?.createdAt && ` · member since ${since.format(new Date(account.createdAt))}`}
          </span>
        </div>
      </div>

      <form onSubmit={save} noValidate className="panel">
        <h2 className="panel-title">Your name</h2>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="alert alert-ok" role="status">
            Saved.
          </p>
        )}
        <div className="field">
          <label htmlFor="name">
            Full name
            <span className="hint">
              {pro
                ? 'Customers see this name on your profile. Use your real name.'
                : 'Pros see this name when you book. Use your real name.'}
            </span>
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <button className="button button-auto" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>

      <section className="panel">
        <h2 className="panel-title">Phone number</h2>
        <p className="big-line">{localPhone(me.phone)}</p>
        <p className="meta">
          You sign in with this number. Only you can see it: GADMO never shows it to{' '}
          {pro ? 'customers' : 'Pros'}. You talk and call inside GADMO.
        </p>
      </section>

      {pro && (
        <section className="panel">
          <h2 className="panel-title">Your work</h2>
          <p className="meta">Skills, travel distance and identity check.</p>
          <div className="fee-actions">
            <Link className="button button-quiet button-small" href="/pro/profile">
              Skills & area
            </Link>
            <Link className="button button-quiet button-small" href="/pro/verify">
              Verification
            </Link>
          </div>
        </section>
      )}
    </AccountShell>
  );
}
