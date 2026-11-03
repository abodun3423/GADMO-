'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, post } from '@/lib/api';
import { localPhone } from '@/lib/format';
import { type Job, JOB_STATUS_LABEL } from '@/lib/types';
import { loadMe, useSession } from '@/lib/useSession';

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export function MyJobs({
  serviceNames,
  justSent,
}: {
  serviceNames: Record<string, string>;
  justSent: boolean;
}) {
  const router = useRouter();
  const { me, loading } = useSession();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api<{ jobs: Job[] }>('/v1/jobs')
      .then((r) => setJobs(r.jobs))
      .catch(() => setError('Your jobs could not be loaded. Check your connection and refresh.'));
  }, [me]);

  async function signOut() {
    await post('/v1/auth/logout').catch(() => undefined);
    await loadMe(true);
    router.replace('/');
    router.refresh();
  }

  if (loading) return <p className="meta">Loading…</p>;

  if (!me) {
    return (
      <>
        <h1 className="page-title">My jobs</h1>
        <p className="lede">Sign in to see the jobs you’ve requested.</p>
        <Link className="button" href="/signin?next=%2Fjobs">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">My jobs</h1>
      <p className="lede">
        Signed in as {localPhone(me.phone)} ({me.role === 'PRO' ? 'Pro' : 'customer'}). Only you can
        see this number.
      </p>

      {!me.name && (
        <p className="alert alert-info">
          Add your name so {me.role === 'PRO' ? 'customers' : 'Pros'} know what to call you.{' '}
          <Link href="/account">Add your name</Link>
        </p>
      )}

      {justSent && (
        <p className="alert alert-info" role="status">
          Request sent. We’ll tell you when a Pro accepts it.
        </p>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {jobs === null && !error && <p className="meta">Loading your jobs…</p>}

      {jobs?.length === 0 &&
        (me.role === 'PRO' ? (
          <p className="empty">
            Jobs assigned to you will appear here.{' '}
            <Link href="/pro/profile">Set up your Pro profile</Link> so customers can find you.
          </p>
        ) : (
          <p className="empty">
            You haven’t requested anything yet. <Link href="/">Find a service</Link> to get started.
          </p>
        ))}

      {jobs?.map((job) => (
        <article key={job.id} className={`job${job.type === 'EMERGENCY' ? ' job-urgent' : ''}`}>
          <h3>{serviceNames[job.categoryId] ?? 'Service'}</h3>
          <p className="meta">
            {job.type === 'EMERGENCY'
              ? `Emergency, requested ${dateFormat.format(new Date(job.createdAt))}`
              : `For ${dateFormat.format(new Date(job.scheduledAt ?? job.createdAt))}`}
          </p>
          <p>{job.description}</p>
          <p className="job-status">{JOB_STATUS_LABEL[job.status]}</p>
        </article>
      ))}

      <button className="button button-quiet button-spaced" type="button" onClick={signOut}>
        Sign out
      </button>
    </>
  );
}
