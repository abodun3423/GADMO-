'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, fieldMessage, post } from '@/lib/api';
import { loadMe } from '@/lib/useSession';

/** GADMO staff sign-in: email + password, then the code sent to their phone. */
export function StaffSignIn({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ message: string }>('/v1/auth/staff/login', { email, password });
      setSentTo(res.message);
      setPassword('');
      setStep('code');
    } catch (err) {
      setError(
        fieldMessage(err) ??
          (err instanceof ApiError ? err.message : 'Could not sign in. Check your connection.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError('The code has 6 digits.');
      return;
    }
    setBusy(true);
    try {
      await post('/v1/auth/staff/verify', { email, code });
      await loadMe(true);
      router.replace(next);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.message === 'Sign in again.') {
        setStep('password');
        setCode('');
      }
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <p className="staff-tag">GADMO Staff</p>
      <h1 className="page-title">Staff sign-in</h1>
      <p className="lede">
        For GADMO staff only. Customers and Pros: <Link href="/signin">sign in here</Link>.
      </p>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {step === 'password' ? (
        <form onSubmit={signIn} noValidate>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <p className="alert alert-info">{sentTo}</p>
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      )}
    </>
  );
}
