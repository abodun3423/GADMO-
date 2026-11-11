'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DisputeItem, DisputeStatus } from '@/lib/types';
import { AdminNav } from './AdminNav';
import { StaffOnly } from './StaffOnly';

export const DISPUTE_LABEL: Record<DisputeStatus, string> = {
  OPEN: 'To review',
  RESOLVED_PRO_PAID: 'Pro paid',
  RESOLVED_REFUNDED: 'Refunded',
  RESOLVED_SPLIT: 'Split',
  RESOLVED_REWORK: 'Sent back to fix',
};

const DONE_TEXT: Record<string, string> = {
  PAY_PRO: 'Settled: the Pro has been paid.',
  REFUND: 'Settled: the customer has been refunded to their GADMO wallet.',
  SPLIT: 'Settled: the payment has been split.',
  SEND_BACK: 'The Pro has been asked to fix the work. The payment stays on hold.',
};

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

export function DisputeList({ status, done }: { status?: string; done?: string }) {
  return (
    <StaffOnly next="/admin/disputes">
      <List tab={status === 'done' ? 'done' : 'open'} done={done} />
    </StaffOnly>
  );
}

function List({ tab, done }: { tab: 'open' | 'done'; done?: string }) {
  const [items, setItems] = useState<DisputeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    api<{ disputes: DisputeItem[] }>(`/v1/admin/disputes?status=${tab}`)
      .then((r) => setItems(r.disputes))
      .catch(() => setError('The list could not be loaded. Check your connection and refresh.'));
  }, [tab]);

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Poor-work reports</h1>
      <p className="lede">
        Customers report problems while GADMO holds the payment. Review the chat, quote and photos,
        then pay the Pro, refund the customer, split it, or send the Pro back to fix the work.
      </p>

      {done && DONE_TEXT[done] && (
        <p className="alert alert-info" role="status">
          {DONE_TEXT[done]}
        </p>
      )}

      <nav className="tabs tabs-sub" aria-label="Filter reports">
        <Link
          href="/admin/disputes"
          className="tab"
          aria-current={tab === 'open' ? 'page' : undefined}
        >
          To review
        </Link>
        <Link
          href="/admin/disputes?status=done"
          className="tab"
          aria-current={tab === 'done' ? 'page' : undefined}
        >
          Settled
        </Link>
      </nav>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="meta">Loading…</p>}
      {items?.length === 0 && <p className="empty">Nothing here.</p>}

      <ul className="review-list">
        {items?.map((item) => (
          <li key={item.id}>
            <Link href={`/admin/disputes/${item.id}`} className="review-item">
              <span className="review-name">
                {item.serviceName} · {item.customerName ?? 'Customer'}
              </span>
              <span className="meta">
                Reported {dateFormat.format(new Date(item.createdAt))}
                {item.resolvedAt && ` · ${DISPUTE_LABEL[item.status]}`}
              </span>
              <span className="meta">“{item.reason}”</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
