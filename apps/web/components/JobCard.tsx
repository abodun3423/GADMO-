import Link from 'next/link';
import type { ReactNode } from 'react';
import { type Job, JOB_STATUS_LABEL, type JobStatus } from '@/lib/types';

/** How far along a job is, out of 100, for the slim bar on job cards. */
const PROGRESS: Record<JobStatus, number> = {
  REQUESTED: 8,
  ACCEPTED: 22,
  INSPECTION_PAID: 38,
  QUOTED: 50,
  QUOTE_ACCEPTED: 60,
  IN_PROGRESS: 74,
  DONE_AWAITING_PAYMENT: 88,
  BALANCE_HELD: 94,
  COMPLETED: 100,
  CASH_COMPLETED: 100,
  DISPUTED: 90,
  CANCELLED: 0,
};

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** A job as a card: service, when, what, where it stands (with a bar) and an action. */
export function JobCard({
  job,
  serviceName,
  status,
  children,
  href,
}: {
  job: Job;
  serviceName: string;
  /** Overrides the standard status text. */
  status?: string;
  /** Actions at the bottom; defaults to "Open chat" once a Pro is on the job. */
  children?: ReactNode;
  href?: string;
}) {
  const urgent = job.type === 'EMERGENCY';
  const done = job.status === 'COMPLETED' || job.status === 'CASH_COMPLETED';
  return (
    <article className={`job-card${urgent ? ' job-card-urgent' : ''}`}>
      <header className="job-card-head">
        <h3>{serviceName}</h3>
        <span className={`job-tag${urgent ? ' job-tag-urgent' : ''}`}>
          {urgent ? 'Emergency' : 'Booked'}
        </span>
      </header>
      <p className="job-card-when">
        {job.scheduledAt
          ? `For ${dateFormat.format(new Date(job.scheduledAt))}`
          : `Asked ${dateFormat.format(new Date(job.createdAt))}`}
      </p>
      <p className="job-card-desc">{job.description}</p>
      {job.status !== 'CANCELLED' && (
        <progress
          className={`job-progress${done ? ' job-progress-done' : ''}`}
          max={100}
          value={PROGRESS[job.status]}
          aria-label="How far along the job is"
        />
      )}
      <p className="job-card-status">{status ?? JOB_STATUS_LABEL[job.status]}</p>
      {children ??
        (href && (
          <Link className="button button-small" href={href}>
            Open chat
          </Link>
        ))}
    </article>
  );
}
