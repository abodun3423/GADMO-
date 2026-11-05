'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post, put } from '@/lib/api';
import { money } from '@/lib/money';
import { useSession } from '@/lib/useSession';
import { AccountShell } from './AccountShell';
import { SignedOut } from './SignedOut';

interface Wallet {
  balanceKobo: number;
  heldKobo: number;
  minWithdrawalKobo: number;
  withdrawalsPaused: boolean;
  bankAccount: { bankName: string; last4: string; accountName: string } | null;
  entries: {
    id: string;
    description: string;
    creditKobo: number;
    debitKobo: number;
    createdAt: string;
  }[];
  withdrawals: {
    id: string;
    amountKobo: number;
    destination: string;
    status: 'PROCESSING' | 'PAID' | 'FAILED' | 'PENDING';
    createdAt: string;
  }[];
}

const when = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const STATUS = { PROCESSING: 'Sending', PENDING: 'Sending', PAID: 'Sent', FAILED: 'Failed' };

function reason(err: unknown, fallback: string): string {
  return fieldMessage(err) ?? (err instanceof ApiError ? err.message : fallback);
}

/** A Pro's earnings or a customer's refunds, with history and withdrawals to the bank. */
export function WalletPage() {
  const { me, loading } = useSession();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setWallet((await api<{ wallet: Wallet }>('/v1/wallet')).wallet);
    } catch {
      setError('Your wallet could not be loaded. Check your connection and refresh.');
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) return <SignedOut next="/account/wallet" title="Wallet" />;
  const pro = me.role === 'PRO';

  return (
    <AccountShell>
      <h1 className="page-title">Wallet</h1>
      <p className="lede">
        {pro
          ? 'Your GADMO earnings. Withdraw them to your bank account any time.'
          : 'Refunds from GADMO land here. Withdraw them to your bank account any time.'}
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!wallet && !error && <p className="meta">Loading…</p>}
      {wallet && (
        <>
          <section className="wallet-card" aria-label="Balance">
            <span className="kpi-label">Available balance</span>
            <span className="wallet-balance">{money(wallet.balanceKobo)}</span>
            {pro && (
              <span className="kpi-note">
                {money(wallet.heldKobo)} on hold: paid by customers, released to you as jobs
                progress.
              </span>
            )}
          </section>

          <Withdraw wallet={wallet} onDone={load} />
          <BankAccount wallet={wallet} onSaved={load} />

          {wallet.withdrawals.length > 0 && (
            <section className="panel">
              <h2 className="panel-title">Withdrawals</h2>
              <ul className="ledger">
                {wallet.withdrawals.map((w) => (
                  <li key={w.id}>
                    <span>
                      <strong>{w.destination}</strong>
                      <span className="meta">{when.format(new Date(w.createdAt))}</span>
                    </span>
                    <span className="ledger-amount">
                      {money(w.amountKobo)}
                      <span className={`ledger-status ledger-${w.status.toLowerCase()}`}>
                        {STATUS[w.status]}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <h2 className="panel-title">History</h2>
            {wallet.entries.length === 0 ? (
              <p className="meta">
                {pro
                  ? 'Nothing yet. Inspection fees, deposits and job payments will show here.'
                  : 'Nothing yet. Any refund from GADMO will show here.'}
              </p>
            ) : (
              <ul className="ledger">
                {wallet.entries.map((e) => {
                  const inflow = e.creditKobo > 0;
                  return (
                    <li key={e.id}>
                      <span>
                        <strong>{e.description}</strong>
                        <span className="meta">{when.format(new Date(e.createdAt))}</span>
                      </span>
                      <span className={`ledger-amount ${inflow ? 'ledger-in' : 'ledger-out'}`}>
                        {inflow ? '+' : '−'}
                        {money(inflow ? e.creditKobo : e.debitKobo)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </AccountShell>
  );
}

function Withdraw({ wallet, onDone }: { wallet: Wallet; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const min = wallet.minWithdrawalKobo;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const n = Number(amount.replace(/[₦,\s]/g, ''));
    if (!Number.isInteger(n) || n <= 0) {
      setMessage({ ok: false, text: 'Enter an amount in whole naira, e.g. 5000.' });
      return;
    }
    if (n * 100 < min) {
      setMessage({ ok: false, text: `You can withdraw ${money(min)} or more.` });
      return;
    }
    if (n * 100 > wallet.balanceKobo) {
      setMessage({ ok: false, text: `You can withdraw up to ${money(wallet.balanceKobo)}.` });
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ withdrawal: { status: string; destination: string } }>(
        '/v1/wallet/withdrawals',
        { amountKobo: n * 100 },
      );
      setAmount('');
      setMessage(
        r.withdrawal.status === 'FAILED'
          ? { ok: false, text: 'The bank didn’t accept it. The money is back in your wallet.' }
          : {
              ok: true,
              text:
                r.withdrawal.status === 'PAID'
                  ? `Sent to ${r.withdrawal.destination}.`
                  : `On its way to ${r.withdrawal.destination}. It usually arrives within minutes.`,
            },
      );
      await onDone();
    } catch (err) {
      setMessage({ ok: false, text: reason(err, 'Not sent. Try again.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Withdraw</h2>
      {wallet.withdrawalsPaused && (
        <p className="alert alert-info">
          Withdrawals are paused for a short while. Your money is safe.
        </p>
      )}
      {!wallet.bankAccount ? (
        <p className="meta">Add your bank account below to withdraw.</p>
      ) : (
        <form onSubmit={submit} noValidate>
          {message && (
            <p
              className={`alert ${message.ok ? 'alert-ok' : 'alert-error'}`}
              role={message.ok ? 'status' : 'alert'}
            >
              {message.text}
            </p>
          )}
          <div className="field">
            <label htmlFor="amount">
              Amount (₦)
              <span className="hint">
                {money(min)} or more. GADMO pays the transfer fee, so the full amount reaches you.
              </span>
            </label>
            <input
              id="amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))}
            />
          </div>
          <div className="fee-actions">
            <button
              className="button button-auto"
              type="submit"
              disabled={busy || wallet.withdrawalsPaused || wallet.balanceKobo < min}
            >
              {busy
                ? 'Sending…'
                : `Withdraw to ${wallet.bankAccount.bankName} ••••${wallet.bankAccount.last4}`}
            </button>
            {wallet.balanceKobo >= min && (
              <button
                className="button button-quiet button-small"
                type="button"
                onClick={() => setAmount(String(Math.floor(wallet.balanceKobo / 100)))}
              >
                Withdraw all
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function BankAccount({ wallet, onSaved }: { wallet: Wallet; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(!wallet.bankAccount);
  const [banks, setBanks] = useState<{ code: string; name: string }[] | null>(null);
  const [bankCode, setBankCode] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || banks) return;
    api<{ banks: { code: string; name: string }[] }>('/v1/wallet/banks')
      .then((r) => setBanks(r.banks))
      .catch(() => setBanks([]));
  }, [editing, banks]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!bankCode) {
      setError('Choose your bank.');
      return;
    }
    if (!/^\d{10}$/.test(number)) {
      setError('Your account number has 10 digits.');
      return;
    }
    setBusy(true);
    try {
      await put('/v1/wallet/bank-account', { bankCode, accountNumber: number });
      setEditing(false);
      setNumber('');
      await onSaved();
    } catch (err) {
      setError(reason(err, 'Not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Bank account</h2>
      {wallet.bankAccount && !editing ? (
        <>
          <p className="big-line">
            {wallet.bankAccount.bankName} ••••{wallet.bankAccount.last4}
          </p>
          <p className="meta">Account name: {wallet.bankAccount.accountName}</p>
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={() => setEditing(true)}
          >
            Change bank account
          </button>
        </>
      ) : (
        <form onSubmit={save} noValidate>
          <p className="meta">
            Use an account in your own name. We check the account with your bank and show you the
            name on it.
          </p>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="field">
            <label htmlFor="bank">Bank</label>
            <select id="bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
              <option value="">{banks ? 'Choose your bank' : 'Loading banks…'}</option>
              {banks?.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="account-number">Account number</label>
            <input
              id="account-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={10}
              placeholder="10 digits"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="fee-actions">
            <button className="button button-auto" type="submit" disabled={busy}>
              {busy ? 'Checking with your bank…' : 'Save bank account'}
            </button>
            {wallet.bankAccount && (
              <button
                className="button button-quiet button-small"
                type="button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
