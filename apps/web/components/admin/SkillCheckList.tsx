'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SkillCheckItem } from '@/lib/types';
import { AdminNav } from './AdminNav';
import { StaffOnly } from './StaffOnly';

type Tab = 'open' | 'done';

const DONE_TEXT: Record<string, string> = {
  PASSED: 'Passed. The Pro is verified and can now go online.',
  FAILED: 'Not passed. The Pro sees your note.',
};

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

export function SkillCheckList({ status, done }: { status?: string; done?: string }) {
  return (
    <StaffOnly next="/admin/skill-checks">
      <List tab={status === 'done' ? 'done' : 'open'} done={done} />
    </StaffOnly>
  );
}

function List({ tab, done }: { tab: Tab; done?: string }) {
  const [items, setItems] = useState<SkillCheckItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    api<{ skillChecks: SkillCheckItem[] }>(`/v1/admin/skill-checks?status=${tab}`)
      .then((r) => setItems(r.skillChecks))
      .catch(() => setError('The list could not be loaded. Check your connection and refresh.'));
  }, [tab]);

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Skill checks</h1>
      <p className="lede">
        Visit Pros whose documents are approved. See their tools, a short demonstration and past
        work, then record pass or fail. Only a pass makes a Pro verified.
      </p>

      {done && DONE_TEXT[done] && (
        <p className="alert alert-info" role="status">
          {DONE_TEXT[done]}
        </p>
      )}

      <nav className="tabs tabs-sub" aria-label="Filter skill checks">
        <Link
          href="/admin/skill-checks"
          className="tab"
          aria-current={tab === 'open' ? 'page' : undefined}
        >
          To visit
        </Link>
        <Link
          href="/admin/skill-checks?status=done"
          className="tab"
          aria-current={tab === 'done' ? 'page' : undefined}
        >
          Done
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
            <Link href={`/admin/skill-checks/${item.id}`} className="review-item">
              <span className="review-name">{item.proName ?? 'No name yet'}</span>
              <span className="meta">
                {item.result === 'PENDING'
                  ? item.scheduledAt
                    ? `Visit ${dateFormat.format(new Date(item.scheduledAt))}${item.visitPlace ? ` · ${item.visitPlace}` : ''}`
                    : 'Visit not booked yet'
                  : `${item.result === 'PASSED' ? 'Passed' : 'Not passed'}${item.checkedAt ? ` · ${dateFormat.format(new Date(item.checkedAt))}` : ''}`}
              </span>
              {item.result === 'PENDING' && !item.scheduledAt && (
                <span className="badge badge-alert">Book a visit</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
