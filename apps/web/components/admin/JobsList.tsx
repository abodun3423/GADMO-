'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminJobRow, JobStatus } from '@/lib/types';
import { naira } from '../InspectionFee';
import { AdminNav } from './AdminNav';
import { dateTime, JOB_STATUS_SHORT } from './labels';
import { StaffOnly } from './StaffOnly';

export function JobsList() {
  return (
    <StaffOnly next="/admin/jobs">
      <Jobs />
    </StaffOnly>
  );
}

export function JobRow({ job }: { job: AdminJobRow }) {
  return (
    <li className={`job${job.type === 'EMERGENCY' ? ' job-urgent' : ''}`}>
      <h3>
        {job.type === 'EMERGENCY' && <span className="badge">Emergency</span>}
        {job.serviceName}
      </h3>
      <p className="meta">
        {JOB_STATUS_SHORT[job.status]} · {dateTime.format(new Date(job.createdAt))}
        {job.inspectionFeeKobo !== null && ` · inspection fee ${naira(job.inspectionFeeKobo)}`}
      </p>
      <p>{job.description}</p>
      <p className="meta">
        Customer:{' '}
        <Link href={`/admin/users/${job.customerId}`}>{job.customerName ?? 'no name yet'}</Link>
        {' · '}Pro:{' '}
        {job.proId ? (
          <Link href={`/admin/users/${job.proId}`}>{job.proName ?? 'no name yet'}</Link>
        ) : (
          'none yet'
        )}
      </p>
    </li>
  );
}

function Jobs() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;
  const [rows, setRows] = useState<AdminJobRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (page > 1) query.set('page', String(page));
    setRows(null);
    api<{ jobs: AdminJobRow[]; hasMore: boolean }>(`/v1/admin/jobs?${query}`)
      .then((r) => {
        setRows(r.jobs);
        setHasMore(r.hasMore);
      })
      .catch(() => setError('Jobs could not be loaded. Check your connection and refresh.'));
  }, [status, page]);

  const go = (next: { status?: string; page?: number }) => {
    const query = new URLSearchParams();
    const s = next.status ?? status;
    const p = next.page ?? 1;
    if (s) query.set('status', s);
    if (p > 1) query.set('page', String(p));
    router.push(`/admin/jobs${query.size ? `?${query}` : ''}`);
  };

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Jobs</h1>
      <div className="filters">
        <div className="field">
          <label htmlFor="job-status">Status</label>
          <select id="job-status" value={status} onChange={(e) => go({ status: e.target.value })}>
            <option value="">All</option>
            {(Object.keys(JOB_STATUS_SHORT) as JobStatus[]).map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_SHORT[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="meta">Loading…</p>}
      {rows?.length === 0 && <p className="empty">No jobs here.</p>}
      <ul className="admin-jobs">
        {rows?.map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </ul>
      <div className="pager">
        {page > 1 && (
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={() => go({ page: page - 1 })}
          >
            Previous
          </button>
        )}
        {hasMore && (
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={() => go({ page: page + 1 })}
          >
            Next
          </button>
        )}
      </div>
    </>
  );
}
