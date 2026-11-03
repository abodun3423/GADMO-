'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, fieldMessage, patch, post } from '@/lib/api';
import { localPhone } from '@/lib/format';
import type { Me } from '@/lib/types';
import { loadMe, useSession } from '@/lib/useSession';

export function Account() {
  const router = useRouter();
  const { me, loading } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me) setName(me.name ?? '');
  }, [me]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await patch<{ user: Me }>('/v1/me', { name });
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

  async function signOut() {
    await post('/v1/auth/logout').catch(() => undefined);
    await loadMe(true);
    router.replace('/');
    router.refresh();
  }

  if (loading) return <p className="meta">Loading…</p>;

  if (!me) {
    return (
      <>
        <h1 className="page-title">My account</h1>
        <p className="lede">Sign in to see your account.</p>
        <Link className="button" href="/signin?next=%2Faccount">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">My account</h1>
      <p className="lede">
        {me.role === 'PRO'
          ? 'Pro account: you offer a skill or service on GADMO.'
          : 'Customer account: you find and book skilled people.'}
      </p>

      {me.role === 'PRO' && (
        <Link className="button button-spaced" href="/pro/profile">
          Your Pro profile: skills and area
        </Link>
      )}

      <form onSubmit={save} noValidate>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="alert alert-info" role="status">
            Saved.
          </p>
        )}
        <div className="field">
          <label htmlFor="name">
            Your name
            <span className="hint">
              {me.role === 'PRO'
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
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>

      <dl className="details">
        <div>
          <dt>Phone number</dt>
          <dd>
            {localPhone(me.phone)}
            <span className="hint">
              Only you can see your number. GADMO never shows it to customers or Pros; you talk in
              GADMO chat.
            </span>
          </dd>
        </div>
      </dl>

      <Link className="button button-quiet button-spaced" href="/jobs">
        My jobs
      </Link>
      <button className="button button-quiet button-spaced" type="button" onClick={signOut}>
        Sign out
      </button>
    </>
  );
}
