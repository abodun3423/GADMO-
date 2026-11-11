'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ReviewItem, ReviewResult } from '@/lib/types';
import { AdminNav } from './AdminNav';
import { StaffOnly } from './StaffOnly';

const TABS: { status: ReviewResult; label: string }[] = [
  { status: 'PENDING', label: 'To review' },
  { status: 'NEEDS_INFO', label: 'Waiting for the Pro' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
];

const DONE_TEXT: Record<string, string> = {
  APPROVED: 'Documents approved. Next: book the Pro’s skill check visit.',
  NEEDS_INFO: 'Sent back to the Pro with your note.',
  REJECTED: 'Rejected. The Pro sees your note.',
};

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export function ReviewQueue({ status, done }: { status?: string; done?: string }) {
  const current = TABS.find((t) => t.status === status)?.status ?? 'PENDING';
  return (
    <StaffOnly next="/admin/checks">
      <Queue status={current} done={done} />
    </StaffOnly>
  );
}

function Queue({ status, done }: { status: ReviewResult; done?: string }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    api<{ verifications: ReviewItem[] }>(`/v1/admin/verifications?status=${status}`)
      .then((r) => setItems(r.verifications))
      .catch(() => setError('The queue could not be loaded. Check your connection and refresh.'));
  }, [status]);

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Identity checks</h1>
      <p className="lede">
        Check that the selfie matches the ID photo, the letter or certificate looks genuine, and the
        trainer confirms. Approved Pros move on to a skill check visit.
      </p>

      {done && DONE_TEXT[done] && (
        <p className="alert alert-info" role="status">
          {DONE_TEXT[done]}
        </p>
      )}

      <nav className="tabs tabs-sub" aria-label="Filter checks">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={t.status === 'PENDING' ? '/admin/checks' : `/admin/checks?status=${t.status}`}
            className="tab"
            aria-current={t.status === status ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
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
            <Link href={`/admin/verifications/${item.id}`} className="review-item">
              <span className="review-name">{item.proName ?? 'No name yet'}</span>
              <span className="meta">
                Sent {dateFormat.format(new Date(item.createdAt))}
                {item.reviewedAt && ` · decided ${dateFormat.format(new Date(item.reviewedAt))}`}
              </span>
              {item.ninUsedElsewhere > 0 && (
                <span className="badge badge-alert">NIN used on another account</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
