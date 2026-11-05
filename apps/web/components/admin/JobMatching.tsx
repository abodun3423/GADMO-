'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { JobMatching } from '@/lib/types';
import { AdminNav } from './AdminNav';
import { ACCOUNT_STATUS_LABEL, CHECK_LABEL, dateTime, JOB_STATUS_SHORT } from './labels';
import { StaffOnly } from './StaffOnly';

type Pro = JobMatching['pros'][number];

/** Each matching rule a Pro fails, in words support can pass on. */
function problems(p: Pro, emergency: boolean): string[] {
  const out: string[] = [];
  if (!p.checks.verified) {
    out.push(`Identity not approved yet (${CHECK_LABEL[p.verificationStatus]}).`);
  }
  if (!p.checks.accountActive) out.push(`Account ${ACCOUNT_STATUS_LABEL[p.accountStatus]}.`);
  if (!p.checks.serviceAreaSet) {
    out.push('No service area set. The Pro chooses one in Pro profile.');
  } else if (!p.checks.withinDistance) {
    out.push(
      `${p.distanceKm} km from the job; travels up to ${p.serviceRadiusKm} km. Check the customer’s location and the Pro’s service area.`,
    );
  }
  if (!p.checks.notAskedYet) out.push(`Already asked about this job (${p.askedStatus}).`);
  if (emergency && !p.checks.onlineIfEmergency)
    out.push('Offline. Emergencies go to online Pros only.');
  return out;
}

export function JobMatchingView({ id }: { id: string }) {
  return (
    <StaffOnly next={`/admin/jobs/${id}`}>
      <Matching id={id} />
    </StaffOnly>
  );
}

function Matching({ id }: { id: string }) {
  const [data, setData] = useState<JobMatching | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<JobMatching>(`/v1/admin/jobs/${id}/matching`)
      .then(setData)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'This job doesn’t exist.'
            : 'This job could not be loaded. Check your connection and refresh.',
        ),
      );
  }, [id]);

  if (error) {
    return (
      <>
        <AdminNav />
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <AdminNav />
        <p className="meta">Loading…</p>
      </>
    );
  }

  const { job, pros, otherPros } = data;
  const emergency = job.type === 'EMERGENCY';
  const matching = pros.filter((p) => p.matches);
  return (
    <>
      <AdminNav />
      <p>
        <Link href="/admin/jobs">← Jobs</Link>
      </p>
      <h1 className="page-title">
        {emergency && <span className="badge">Emergency</span>} {job.serviceName}
      </h1>
      <p className="meta">
        {JOB_STATUS_SHORT[job.status]} · requested {dateTime.format(new Date(job.createdAt))}
        {job.scheduledAt && ` · for ${dateTime.format(new Date(job.scheduledAt))}`} · customer{' '}
        <Link href={`/admin/users/${job.customerId}`}>{job.customerName ?? 'no name yet'}</Link>
      </p>
      <p>{job.description}</p>

      <h2 className="section-title">Which Pros can take it?</h2>
      <p className={`alert ${matching.length ? 'alert-ok' : 'alert-info'}`} role="status">
        {pros.length === 0
          ? `No Pro offers ${job.serviceName} yet. A Pro adds it in Pro profile → skills.`
          : matching.length === 0
            ? `${pros.length} ${pros.length === 1 ? 'Pro offers' : 'Pros offer'} ${job.serviceName}, but none can take this job yet. The reasons are below.`
            : `${matching.length} ${matching.length === 1 ? 'Pro' : 'Pros'} can take this job${emergency ? ' right now' : ' (the customer sees them on “Choose a Pro”)'}.`}
      </p>
      <ul className="admin-jobs">
        {pros.map((p) => {
          const issues = problems(p, emergency);
          return (
            <li key={p.id} className="job">
              <h3>
                <Link href={`/admin/users/${p.id}`}>{p.name ?? 'no name yet'}</Link>{' '}
                {p.matches ? (
                  <span className="badge badge-ok">Can take it</span>
                ) : (
                  <span className="badge badge-plain">Can’t take it</span>
                )}
              </h3>
              <p className="meta">
                {CHECK_LABEL[p.verificationStatus]} · {p.isOnline ? 'online' : 'offline'}
                {p.distanceKm !== null &&
                  ` · ${p.distanceKm} km away (travels ${p.serviceRadiusKm} km)`}
              </p>
              {issues.length > 0 && (
                <ul className="issues">
                  {issues.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {otherPros.length > 0 && (
        <>
          <h2 className="section-title">Pros who don’t offer {job.serviceName}</h2>
          <p className="meta">In case a Pro picked a similar skill by mistake.</p>
          <ul className="admin-jobs">
            {otherPros.map((p) => (
              <li key={p.id} className="job">
                <Link href={`/admin/users/${p.id}`}>{p.name ?? 'no name yet'}</Link>
                <span className="meta">
                  {' '}
                  · {p.skills.length ? p.skills.join(', ') : 'no skills chosen yet'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
