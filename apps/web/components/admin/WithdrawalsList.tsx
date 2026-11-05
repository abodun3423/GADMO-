'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, post } from '@/lib/api';
import { money } from '@/lib/money';
import { AdminNav } from './AdminNav';
import { dateTime } from './labels';
import { StaffOnly } from './StaffOnly';

interface Row {
  id: string;
  userId: string;
  name: string | null;
  role: string;
  amountKobo: number;
  destination: string;
  status: 'PROCESSING' | 'PAID' | 'FAILED' | 'PENDING';
  createdAt: string;
}

const STATUS = { PROCESSING: 'Sending', PENDING: 'Sending', PAID: 'Sent', FAILED: 'Failed' };

export function WithdrawalsList() {
  return (
    <StaffOnly next="/admin/withdrawals">
      <Withdrawals />
    </StaffOnly>
  );
}

function Withdrawals() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ paused: boolean; withdrawals: Row[] }>('/v1/admin/withdrawals');
      setRows(r.withdrawals);
      setPaused(r.paused);
    } catch {
      setError('Withdrawals could not be loaded. Check your connection and refresh.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Withdrawals</h1>
      <div className={`panel ${paused ? 'panel-danger' : ''}`}>
        <p>
          <strong>{paused ? 'Withdrawals are paused.' : 'Withdrawals are running.'}</strong>{' '}
          {paused
            ? 'Nobody can withdraw until you resume. Balances are untouched.'
            : 'Pause them all at once if you suspect fraud or a payment problem.'}
        </p>
        <button
          className={`button button-small ${paused ? '' : 'button-danger'}`}
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await post('/v1/admin/withdrawals/pause', { paused: !paused }).catch(() =>
              setError('Not changed. Try again.'),
            );
            await load();
            setBusy(false);
          }}
        >
          {paused ? 'Resume withdrawals' : 'Pause all withdrawals'}
        </button>
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {rows?.length === 0 && <p className="empty">No withdrawals yet.</p>}
      <ul className="ledger">
        {rows?.map((w) => (
          <li key={w.id}>
            <span>
              <strong>
                <Link href={`/admin/users/${w.userId}`}>{w.name ?? 'no name yet'}</Link> (
                {w.role === 'PRO' ? 'Pro' : 'customer'}) to {w.destination}
              </strong>
              <span className="meta">{dateTime.format(new Date(w.createdAt))}</span>
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
    </>
  );
}
