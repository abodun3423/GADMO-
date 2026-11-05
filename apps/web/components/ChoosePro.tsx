'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';
import type { ChoosablePro } from '@/lib/types';
import { useSession } from '@/lib/useSession';

const answerBy = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Scheduled jobs: the customer picks one of the verified Pros nearby. */
export function ChoosePro({ jobId }: { jobId: string }) {
  const { me, loading } = useSession();
  const [pros, setPros] = useState<ChoosablePro[] | null>(null);
  const [sent, setSent] = useState<{ name: string | null; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    api<{ pros: ChoosablePro[] }>(`/v1/jobs/${jobId}/pros`)
      .then((r) => setPros(r.pros))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.status === 404
              ? 'This job does not exist, or it isn’t yours.'
              : err.message
            : 'Pros could not be loaded. Check your connection and refresh.',
        ),
      );
  }, [me, jobId]);

  async function choose(pro: ChoosablePro) {
    setError(null);
    setBusy(pro.id);
    try {
      const { request } = await post<{ request: { proName: string | null; expiresAt: string } }>(
        `/v1/jobs/${jobId}/requests`,
        { proId: pro.id },
      );
      setSent({ name: request.proName, expiresAt: request.expiresAt });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Try again.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) {
    return (
      <>
        <h1 className="page-title">Choose a Pro</h1>
        <Link
          className="button"
          href={`/signin?next=${encodeURIComponent(`/jobs/${jobId}/choose`)}`}
        >
          Sign in
        </Link>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <h1 className="page-title">Request sent</h1>
        <div className="status status-online" role="status">
          <h2>Sent to {sent.name ?? 'your Pro'}</h2>
          <p>
            They have until {answerBy.format(new Date(sent.expiresAt))} to accept. When they do, you
            can chat with them in GADMO. If they can’t, you’ll choose another Pro.
          </p>
          <Link className="button" href="/jobs">
            Go to My jobs
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="meta">
        <Link href="/jobs">← My jobs</Link>
      </p>
      <h1 className="page-title">Choose a Pro</h1>
      <p className="lede">
        Verified Pros near you who offer this service. Send your request to one; if they can’t take
        it, you can choose another.
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {pros === null && !error && <p className="meta">Finding Pros near you…</p>}
      {pros?.length === 0 && (
        <p className="empty">
          No verified Pros for this service near you yet. Your request stays in My jobs; check back
          later, or cancel it there.
        </p>
      )}
      <ul className="pro-list">
        {pros?.map((p) => (
          <li key={p.id} className="pro-card">
            <h2>
              {p.name ?? 'GADMO Pro'} <span className="badge badge-ok">Verified</span>
            </h2>
            <p className="meta">
              {p.ratingCount > 0
                ? `★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount} ${p.ratingCount === 1 ? 'review' : 'reviews'})`
                : 'New on GADMO'}
              {' · '}about {p.distanceKm} km away
            </p>
            {p.bio && <p>{p.bio}</p>}
            <p className="meta">{p.skills.join(', ')}</p>
            <button
              className="button"
              type="button"
              disabled={busy !== null}
              onClick={() => choose(p)}
            >
              {busy === p.id ? 'Sending…' : `Send request to ${p.name ?? 'this Pro'}`}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
