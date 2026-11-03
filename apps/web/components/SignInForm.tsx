'use client';

import { normalizeNigerianPhone } from '@gadmo/shared/phone';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { loadMe } from '@/lib/useSession';

type Step = 'phone' | 'code';

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<'customer' | 'pro'>('customer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  async function sendCode(): Promise<boolean> {
    setBusy(true);
    try {
      await post('/v1/auth/otp/request', { phone });
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizeNigerianPhone(phone)) {
      setError('Enter a Nigerian mobile number, for example 0803 123 4567.');
      return;
    }
    if (await sendCode()) {
      setResent(false);
      setStep('code');
    }
  }

  async function resendCode() {
    setError(null);
    setCode('');
    if (await sendCode()) setResent(true);
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
      const { user } = await post<{ user: { role: string } }>('/v1/auth/otp/verify', {
        phone,
        code,
        role,
      });
      await loadMe(true);
      // Pros and staff land on their own home unless they were on their way somewhere.
      const home =
        user.role === 'PRO'
          ? '/pro'
          : user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
            ? '/admin'
            : '/';
      router.replace(next === '/' ? home : next);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That code is wrong or has expired. Check the SMS or ask for a new code.'
          : err instanceof ApiError
            ? err.message
            : 'Could not sign you in. Try again.',
      );
      setBusy(false);
    }
  }

  if (step === 'phone') {
    return (
      <form onSubmit={requestCode} noValidate>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0803 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Sending code…' : 'Send me a code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} noValidate>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <p className="alert alert-info" role="status">
        {resent ? 'We sent a new code to ' : 'We sent a code to '}
        <strong>{phone}</strong>. It expires in 5 minutes. Only the newest code works.
      </p>
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

      <fieldset className="fieldset">
        <legend className="legend">
          New to GADMO? How will you use it?
          <span className="hint">Already have an account? This is ignored and you’ll sign in.</span>
        </legend>
        <label className="choice">
          <input
            type="radio"
            name="role"
            value="customer"
            checked={role === 'customer'}
            onChange={() => setRole('customer')}
          />
          <span>
            <strong>I need help</strong>
            Find and book skilled people.
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="role"
            value="pro"
            checked={role === 'pro'}
            onChange={() => setRole('pro')}
          />
          <span>
            <strong>I offer a skill or service</strong>
            Get jobs from customers near you.
          </span>
        </label>
      </fieldset>

      <button className="button" type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
      <button
        className="button button-quiet button-spaced"
        type="button"
        disabled={busy}
        onClick={resendCode}
      >
        Send a new code
      </button>
      <button
        className="button button-quiet button-spaced"
        type="button"
        onClick={() => {
          setStep('phone');
          setCode('');
          setError(null);
        }}
      >
        Use a different number
      </button>
    </form>
  );
}
