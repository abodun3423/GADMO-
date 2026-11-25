'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { priceGuide } from '@/lib/money';
import type { PublicPro } from '@/lib/types';
import { useSession } from '@/lib/useSession';
import { ProReviews } from './ProReviews';
import { stars } from './RateJob';

const monthYear = new Intl.DateTimeFormat('en-NG', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Africa/Lagos',
});

/**
 * A Pro's public profile (PRD: skills, rating, verified badge, price guide), opened from
 * "Choose a Pro" or the job chat. Never their location, phone or email.
 */
export function ProProfileView({ proId, back }: { proId: string; back: string | null }) {
  const { me } = useSession();
  const [pro, setPro] = useState<PublicPro | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    if (!me) return;
    let live = true;
    api<{ user: PublicPro | { role: string } }>(`/v1/users/${proId}`)
      .then((r) => {
        if (!live) return;
        if (r.user.role !== 'PRO') return setState('missing');
        setPro(r.user as PublicPro);
        setState('ready');
      })
      .catch(
        (err) =>
          live && setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'),
      );
    return () => {
      live = false;
    };
  }, [me, proId]);

  const backLink = (
    <p>
      <Link href={back ?? '/jobs'}>← Back</Link>
    </p>
  );

  if (me === null) {
    return (
      <p className="alert alert-info">
        <Link href={`/signin?next=${encodeURIComponent(`/pros/${proId}`)}`}>Sign in</Link> to see
        this Pro’s profile.
      </p>
    );
  }
  if (state === 'loading' || me === undefined) return <p className="meta">Loading profile…</p>;
  if (state === 'missing') {
    return (
      <>
        {backLink}
        <p className="alert alert-info">This profile isn’t available.</p>
      </>
    );
  }
  if (state === 'error' || !pro) {
    return (
      <>
        {backLink}
        <p className="alert alert-error" role="alert">
          The profile could not be loaded. Check your connection and refresh.
        </p>
      </>
    );
  }

  const verified = pro.verificationStatus === 'APPROVED';
  const prices = priceGuide(pro.priceFromKobo, pro.priceToKobo);
  return (
    <>
      {backLink}
      <header className="profile-head">
        <h1 className="page-title">
          {pro.name ?? 'GADMO Pro'} {verified && <span className="badge badge-ok">Verified</span>}
        </h1>
        <p className="meta">
          {pro.ratingCount > 0 ? (
            <>
              <span
                className="review-stars"
                aria-label={`${pro.ratingAvg.toFixed(1)} out of 5 stars`}
              >
                {stars(Math.round(pro.ratingAvg))}
              </span>{' '}
              {pro.ratingAvg.toFixed(1)} from {pro.ratingCount}{' '}
              {pro.ratingCount === 1 ? 'rating' : 'ratings'}
            </>
          ) : (
            'No ratings yet'
          )}
          {' · '}
          {pro.jobsCompleted} {pro.jobsCompleted === 1 ? 'job' : 'jobs'} done on GADMO
          {' · '}
          On GADMO since {monthYear.format(new Date(pro.memberSince))}
        </p>
      </header>

      <section className="panel profile-section" aria-labelledby="skills-title">
        <h2 id="skills-title">Skills</h2>
        <ul className="chip-list">
          {pro.skills.map((s) => (
            <li key={s.id} className="chip">
              {s.name}
            </li>
          ))}
        </ul>
        {pro.bio && <p>{pro.bio}</p>}
      </section>

      <section className="panel profile-section" aria-labelledby="prices-title">
        <h2 id="prices-title">Price guide</h2>
        {prices ? (
          <>
            <p className="price-guide">{prices}</p>
            {pro.priceNote && <p>{pro.priceNote}</p>}
          </>
        ) : (
          <p className="meta">This Pro hasn’t added a price guide yet.</p>
        )}
        <p className="meta">
          Only a guide. You agree the real price with the Pro in GADMO chat, and pay it through
          GADMO, so it’s covered by the GADMO Guarantee.
        </p>
      </section>

      <section className="panel profile-section" aria-labelledby="reviews-title">
        <h2 id="reviews-title">Reviews</h2>
        {pro.ratingCount === 0 ? (
          <p className="meta">No reviews yet.</p>
        ) : (
          <ProReviews proId={pro.id} count={pro.ratingCount} open />
        )}
      </section>
    </>
  );
}
