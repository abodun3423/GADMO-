'use client';

import { AlertsPrompt } from './AlertsPrompt';
import { forgetAlerts } from '@/lib/alerts';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';
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
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJobs((await api<{ jobs: Job[] }>('/v1/jobs')).jobs);
    } catch {
      setError('Your jobs could not be loaded. Check your connection and refresh.');
    }
  }, []);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  // While a request is waiting for a Pro, check for news every 15 seconds.
  const waiting = jobs?.some((j) => j.status === 'REQUESTED') ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function cancel(id: string) {
    setError(null);
    try {
      await post(`/v1/jobs/${id}/cancel`);
      setConfirming(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel. Try again.');
    }
  }

  async function signOut() {
    await forgetAlerts();
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
      {me.role === 'CUSTOMER' && (
        <AlertsPrompt why="so you know the moment a Pro accepts your request or sends you a message." />
      )}

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
          <p className={`job-status${job.dispatch === 'NO_PRO_YET' ? ' job-status-wait' : ''}`}>
            {statusText(job)}
          </p>
          {job.dispatch === 'CHOOSE_PRO' && me.role !== 'PRO' && (
            <Link className="button button-small" href={`/jobs/${job.id}/choose`}>
              Choose a Pro
            </Link>
          )}
          {job.proId && job.status !== 'CANCELLED' && (
            <Link className="button button-small" href={`/jobs/${job.id}`}>
              Open chat
            </Link>
          )}
          {job.status === 'REQUESTED' &&
            me.role !== 'PRO' &&
            (confirming === job.id ? (
              <div className="confirm">
                <p>Cancel this request?</p>
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => cancel(job.id)}
                >
                  Yes, cancel it
                </button>
                <button
                  className="button button-quiet button-small"
                  type="button"
                  onClick={() => setConfirming(null)}
                >
                  Keep it
                </button>
              </div>
            ) : (
              <button
                className="button button-quiet button-small"
                type="button"
                onClick={() => setConfirming(job.id)}
              >
                Cancel request
              </button>
            ))}
        </article>
      ))}

      <button className="button button-quiet button-spaced" type="button" onClick={signOut}>
        Sign out
      </button>
    </>
  );
}

const answerBy = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function statusText(job: Job): string {
  if (job.dispatch === 'OFFERED' && job.requestedPro) {
    return `Waiting for ${job.requestedPro.name ?? 'your Pro'} to answer (by ${answerBy.format(new Date(job.requestedPro.answerBy))}).`;
  }
  if (job.dispatch === 'OFFERED') return 'Finding a Pro near you…';
  if (job.dispatch === 'CHOOSE_PRO') return 'Choose a Pro for this job.';
  if (job.dispatch === 'NO_PRO_YET') {
    return 'No Pro available yet. We’ll offer it to Pros near you as they come online.';
  }
  if (job.status === 'ACCEPTED') {
    return `${job.proName ?? 'A Pro'} accepted. Chat to agree the details.`;
  }
  return JOB_STATUS_LABEL[job.status];
}
