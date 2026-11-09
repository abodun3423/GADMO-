'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminOverviewData, JobStatus } from '@/lib/types';
import { useSession } from '@/lib/useSession';
import { Welcome } from '../account/Welcome';
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

  const { me } = useSession();
  const today = new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const disputes = data?.jobsByStatus.DISPUTED ?? 0;
  const statusMax = data ? Math.max(1, ...Object.values(data.jobsByStatus).map((n) => n ?? 0)) : 1;

  return (
    <>
      <AdminNav />
      <Welcome
        title="Overview"
        subtitle={`${me?.name ? `Hello, ${me.name.split(' ')[0]}. ` : ''}Here’s GADMO on ${today}.`}
      >
        <Link className="button button-light" href="/admin/checks">
          Review identity checks
        </Link>
        <Link className="button button-ghost" href="/admin/jobs">
          All jobs
        </Link>
      </Welcome>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="meta">Loading…</p>}
      {data && (
        <>
          {(data.checksWaiting > 0 || disputes > 0) && (
            <section className="attention" aria-labelledby="attention-title">
              <h2 id="attention-title" className="section-title">
                Needs your attention
              </h2>
              <ul>
                {data.checksWaiting > 0 && (
                  <li>
                    <Link href="/admin/checks">
                      <strong>{data.checksWaiting}</strong>
                      {data.checksWaiting === 1
                        ? ' identity check is waiting for review'
                        : ' identity checks are waiting for review'}
                    </Link>
                  </li>
                )}
                {disputes > 0 && (
                  <li>
                    <Link href="/admin/jobs?status=DISPUTED">
                      <strong>{disputes}</strong>
                      {disputes === 1 ? ' job is disputed' : ' jobs are disputed'}
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )}

          <ul className="stats" aria-label="GADMO in numbers">
            <Stat label="Customers" value={data.customers} href="/admin/users?role=CUSTOMER" />
            <Stat label="Pros" value={data.pros} href="/admin/users?role=PRO" />
            <Stat
              label="Verified Pros"
              value={data.prosVerified}
              note={
                data.pros > 0
                  ? `${Math.round((data.prosVerified / data.pros) * 100)}% of Pros`
                  : undefined
              }
            />
            <Stat label="Pros online now" value={data.prosOnline} live />
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
              value={disputes}
              href="/admin/jobs?status=DISPUTED"
              alert={disputes > 0}
            />
          </ul>

          <h2 className="section-title">Jobs by status</h2>
          <ul className="status-bars">
            {(Object.keys(JOB_STATUS_SHORT) as JobStatus[]).map((s) => (
              <li key={s}>
                <Link href={`/admin/jobs?status=${s}`}>{JOB_STATUS_SHORT[s]}</Link>
                <meter
                  min={0}
                  max={statusMax}
                  value={data.jobsByStatus[s] ?? 0}
                  aria-label={`${JOB_STATUS_SHORT[s]}: ${data.jobsByStatus[s] ?? 0}`}
                />
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
  note,
  live,
}: {
  label: string;
  value: number;
  href?: string;
  alert?: boolean;
  note?: string;
  /** A live number (shows a green dot). */
  live?: boolean;
}) {
  const body = (
    <>
      <span className="stat-value">
        {live && <span className="live-dot" aria-hidden="true" />}
        {value.toLocaleString('en-NG')}
      </span>
      <span className="stat-label">{label}</span>
      {note && <span className="stat-note">{note}</span>}
    </>
  );
  return (
    <li className={`stat${alert ? ' stat-alert' : ''}`}>
      {href ? <Link href={href}>{body}</Link> : <div>{body}</div>}
    </li>
  );
}
