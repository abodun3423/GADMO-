'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, post } from '@/lib/api';
import {
  type Job,
  JOB_STATUS_LABEL,
  type NearbyJob,
  type Offer,
  type ProProfile,
} from '@/lib/types';
import { useSession } from '@/lib/useSession';

const REFRESH_MS = 30_000;
/** Emergency offers last 2 minutes, so they are checked for often. */
const OFFER_REFRESH_MS = 8_000;

const timeFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const VERIFICATION_TEXT: Record<ProProfile['verificationStatus'], string> = {
  NOT_STARTED: 'Not verified yet: your NIN, a photo of your ID and a selfie.',
  PENDING: 'Under review by GADMO. We’ll let you know.',
  APPROVED: 'Verified. Customers see your verified badge.',
  REJECTED: 'Not approved. See why and try again.',
  NEEDS_INFO: 'GADMO needs a little more information.',
};

export function ProHome({ serviceNames }: { serviceNames: Record<string, string> }) {
  const { me, loading } = useSession();
  const [profile, setProfile] = useState<ProProfile | null>(null);
  const [jobs, setJobs] = useState<NearbyJob[] | null>(null);
  const [offers, setOffers] = useState<(Offer & { receivedAt: number })[]>([]);
  const [mine, setMine] = useState<Job[] | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await api<{ online: boolean; jobs: NearbyJob[] }>('/v1/pro/jobs/nearby');
      setJobs(res.jobs);
    } catch {
      setError('Requests could not be loaded. Check your connection.');
    }
  }, []);

  const loadOffers = useCallback(async () => {
    try {
      const res = await api<{ offers: Offer[] }>('/v1/pro/offers');
      // performance.now() is a steady clock, so the countdown is right even if the
      // device's clock is wrong; the seconds left come from GADMO's server.
      const receivedAt = performance.now();
      setOffers(res.offers.map((o) => ({ ...o, receivedAt })));
    } catch {
      // Keep the last list; the next check will try again.
    }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      const res = await api<{ jobs: Job[] }>('/v1/jobs');
      setMine(res.jobs.filter((j) => j.status !== 'CANCELLED'));
    } catch {
      setMine([]);
    }
  }, []);

  useEffect(() => {
    if (me?.role !== 'PRO') return;
    void loadMine();
    api<{ profile: ProProfile }>('/v1/pro/profile')
      .then((r) => setProfile(r.profile))
      .catch(() =>
        setError('Your profile could not be loaded. Check your connection and refresh.'),
      );
  }, [me, loadMine]);

  const online = profile?.isOnline === true && profile.verificationStatus === 'APPROVED';

  // While online, check for emergency offers often and scheduled requests every 30 seconds
  // (only while the page is visible).
  useEffect(() => {
    if (!online) return;
    void loadJobs();
    void loadOffers();
    const jobsTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadJobs();
    }, REFRESH_MS);
    const offersTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadOffers();
    }, OFFER_REFRESH_MS);
    return () => {
      clearInterval(jobsTimer);
      clearInterval(offersTimer);
    };
  }, [online, loadJobs, loadOffers]);

  // Ticks the countdown on offers once a second.
  const [, setNow] = useState(0);
  useEffect(() => {
    if (offers.length === 0) return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [offers.length]);

  async function answer(offer: Offer, accept: boolean) {
    setError(null);
    setNotice(null);
    setAnswering(offer.id);
    try {
      await post(`/v1/pro/offers/${offer.id}/${accept ? 'accept' : 'decline'}`);
      setOffers((list) => list.filter((o) => o.id !== offer.id));
      if (accept) {
        setNotice('Job accepted. It’s in Your jobs below.');
        await loadMine();
      }
    } catch (err) {
      setOffers((list) => list.filter((o) => o.id !== offer.id));
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Too late: that request is no longer available.'
          : 'Could not answer. Check your connection.',
      );
    } finally {
      setAnswering(null);
    }
  }

  async function setOnline(next: boolean) {
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ profile: ProProfile }>('/v1/pro/online', { online: next });
      setProfile(res.profile);
      if (!next) {
        setJobs(null);
        setOffers([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your status. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;

  if (!me) {
    return (
      <>
        <h1 className="page-title">Pro home</h1>
        <p className="lede">Sign in with your Pro account to get jobs near you.</p>
        <Link className="button" href="/signin?next=%2Fpro">
          Sign in
        </Link>
      </>
    );
  }

  if (me.role !== 'PRO') {
    return (
      <>
        <h1 className="page-title">Pro home</h1>
        <p className="lede">This page is for Pros. Your account is a customer account.</p>
        <Link className="button" href="/">
          Find a service
        </Link>
      </>
    );
  }

  const profileDone = !!profile && profile.categoryIds.length > 0 && profile.latitude !== null;
  const verified = profile?.verificationStatus === 'APPROVED';

  return (
    <>
      <h1 className="page-title">{me.name ? `Hello, ${me.name.split(' ')[0]}` : 'Pro home'}</h1>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-info" role="status">
          {notice}
        </p>
      )}
      {!profile && !error && <p className="meta">Loading…</p>}

      {profile && (
        <>
          <ul className="steps">
            <li className={profileDone ? 'step-done' : undefined}>
              <strong>Profile</strong>{' '}
              {profileDone ? (
                <>
                  {profile.categoryIds.length}{' '}
                  {profile.categoryIds.length === 1 ? 'skill' : 'skills'}, up to{' '}
                  {profile.serviceRadiusKm} km. <Link href="/pro/profile">Edit</Link>
                </>
              ) : (
                <>
                  Add your skills and where you work.{' '}
                  <Link href="/pro/profile">Set up your profile</Link>
                </>
              )}
            </li>
            <li className={verified ? 'step-done' : undefined}>
              <strong>Identity</strong> {VERIFICATION_TEXT[profile.verificationStatus]}{' '}
              {['NOT_STARTED', 'NEEDS_INFO', 'REJECTED'].includes(profile.verificationStatus) && (
                <Link href="/pro/verify">Verify your identity</Link>
              )}
            </li>
          </ul>

          <section
            className={`status${online ? ' status-online' : ''}`}
            aria-labelledby="status-title"
          >
            <h2 id="status-title">{online ? 'You’re online' : 'You’re offline'}</h2>
            <p>
              {online
                ? 'Customers near you can send you requests.'
                : verified && profileDone
                  ? 'Go online when you’re ready to take jobs.'
                  : 'You can go online once your profile is set up and your identity is verified.'}
            </p>
            <button
              className={`button${online ? ' button-quiet' : ''}`}
              type="button"
              disabled={busy || (!online && !(verified && profileDone))}
              onClick={() => setOnline(!online)}
            >
              {busy ? 'Please wait…' : online ? 'Go offline' : 'Go online'}
            </button>
          </section>

          {online &&
            offers.map((offer) => {
              const left = Math.max(
                0,
                Math.round(offer.secondsLeft - (performance.now() - offer.receivedAt) / 1000),
              );
              return (
                <section key={offer.id} className="offer" aria-label="Emergency request for you">
                  <p className="offer-timer" role="timer">
                    {left > 0
                      ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left to accept`
                      : 'Time is up'}
                  </p>
                  <h2>
                    <span className="badge">Emergency</span>
                    {serviceNames[offer.job.categoryId] ?? 'Service'}
                  </h2>
                  <p className="meta">About {offer.distanceKm} km away</p>
                  <p>{offer.job.description}</p>
                  <div className="offer-actions">
                    <button
                      className="button"
                      type="button"
                      disabled={answering === offer.id || left === 0}
                      onClick={() => answer(offer, true)}
                    >
                      Accept
                    </button>
                    <button
                      className="button button-quiet"
                      type="button"
                      disabled={answering === offer.id || left === 0}
                      onClick={() => answer(offer, false)}
                    >
                      Decline
                    </button>
                  </div>
                </section>
              );
            })}

          {mine && mine.length > 0 && (
            <section aria-labelledby="mine-title">
              <h2 id="mine-title" className="section-title">
                Your jobs
              </h2>
              {mine.map((job) => (
                <article
                  key={job.id}
                  className={`job${job.type === 'EMERGENCY' ? ' job-urgent' : ''}`}
                >
                  <h3>{serviceNames[job.categoryId] ?? 'Service'}</h3>
                  <p>{job.description}</p>
                  <p className="job-status">
                    {job.status === 'ACCEPTED'
                      ? 'You accepted. Chat and the inspection fee are coming next.'
                      : JOB_STATUS_LABEL[job.status]}
                  </p>
                </article>
              ))}
            </section>
          )}

          {online && (
            <section aria-labelledby="nearby-title">
              <h2 id="nearby-title" className="section-title">
                Scheduled requests near you
              </h2>
              <p className="meta">
                Emergencies come to you one at a time, above, with 2 minutes to accept. Scheduled
                requests are listed here; customers will choose a Pro for these soon.
              </p>
              {jobs === null && <p className="meta">Looking for requests…</p>}
              {jobs?.length === 0 && (
                <p className="empty">No scheduled requests near you right now.</p>
              )}
              {jobs?.map((job) => (
                <article
                  key={job.id}
                  className={`job${job.type === 'EMERGENCY' ? ' job-urgent' : ''}`}
                >
                  <h3>{serviceNames[job.categoryId] ?? 'Service'}</h3>
                  <p className="meta">
                    About {job.distanceKm} km away · for{' '}
                    {timeFormat.format(new Date(job.scheduledAt ?? job.createdAt))}
                  </p>
                  <p>{job.description}</p>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
