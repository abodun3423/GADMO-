'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminOverviewData, JobStatus } from '@/lib/types';
import { AdminNav } from './AdminNav';
import { JOB_STATUS_SHORT } from './labels';
import { StaffOnly } from './StaffOnly';

export function AdminOverview() {
  return (
    <StaffOnly next="/admin">
      <Overview />
    </StaffOnly>
  );
}

function Overview() {
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ overview: AdminOverviewData }>('/v1/admin/overview')
      .then((r) => setData(r.overview))
      .catch(() =>
        setError('The overview could not be loaded. Check your connection and refresh.'),
      );
  }, []);

  const open = (s: Partial<Record<JobStatus, number>>) =>
    (s.REQUESTED ?? 0) +
    (s.ACCEPTED ?? 0) +
    (s.INSPECTION_PAID ?? 0) +
    (s.QUOTED ?? 0) +
    (s.QUOTE_ACCEPTED ?? 0) +
    (s.IN_PROGRESS ?? 0) +
    (s.DONE_AWAITING_PAYMENT ?? 0) +
    (s.BALANCE_HELD ?? 0);

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Overview</h1>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="meta">Loading…</p>}
      {data && (
        <>
          <ul className="stats" aria-label="GADMO in numbers">
            <Stat label="Customers" value={data.customers} href="/admin/users?role=CUSTOMER" />
            <Stat label="Pros" value={data.pros} href="/admin/users?role=PRO" />
            <Stat label="Verified Pros" value={data.prosVerified} />
            <Stat label="Pros online now" value={data.prosOnline} />
            <Stat
              label="Identity checks to review"
              value={data.checksWaiting}
              href="/admin/checks"
              alert={data.checksWaiting > 0}
            />
            <Stat label="Jobs today" value={data.jobsToday} href="/admin/jobs" />
            <Stat label="Open jobs" value={open(data.jobsByStatus)} href="/admin/jobs" />
            <Stat
              label="Disputes"
              value={data.jobsByStatus.DISPUTED ?? 0}
              href="/admin/jobs?status=DISPUTED"
              alert={(data.jobsByStatus.DISPUTED ?? 0) > 0}
            />
          </ul>

          <h2 className="section-title">Jobs by status</h2>
          <ul className="status-counts">
            {(Object.keys(JOB_STATUS_SHORT) as JobStatus[]).map((s) => (
              <li key={s}>
                <Link href={`/admin/jobs?status=${s}`}>{JOB_STATUS_SHORT[s]}</Link>
                <span>{data.jobsByStatus[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  href,
  alert,
}: {
  label: string;
  value: number;
  href?: string;
  alert?: boolean;
}) {
  const body = (
    <>
      <span className="stat-value">{value.toLocaleString('en-NG')}</span>
      <span className="stat-label">{label}</span>
    </>
  );
  return (
    <li className={`stat${alert ? ' stat-alert' : ''}`}>
      {href ? <Link href={href}>{body}</Link> : <div>{body}</div>}
    </li>
  );
}
