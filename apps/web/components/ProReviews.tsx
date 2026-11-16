'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { ProReview } from '@/lib/types';
import { stars } from './RateJob';

const dayFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Africa/Lagos',
});

/** A Pro's newest ratings, shown to customers without the names of who gave them. */
export function ProReviews({ proId, count }: { proId: string; count: number }) {
  const [reviews, setReviews] = useState<ProReview[] | null>(null);
  const [error, setError] = useState(false);
  if (count === 0) return null;

  async function load() {
    if (reviews) return;
    try {
      setReviews((await api<{ reviews: ProReview[] }>(`/v1/pros/${proId}/reviews`)).reviews);
    } catch {
      setError(true);
    }
  }

  return (
    <details className="pro-reviews" onToggle={(e) => e.currentTarget.open && void load()}>
      <summary>See {count === 1 ? 'the review' : `${count} reviews`}</summary>
      {error && <p className="meta">Reviews could not be loaded. Please try again.</p>}
      {reviews === null && !error && <p className="meta">Loading reviews…</p>}
      <ul>
        {reviews?.map((r, i) => (
          <li key={i}>
            <p className="meta">
              <span className="review-stars" aria-label={`${r.rating} out of 5 stars`}>
                {stars(r.rating)}
              </span>{' '}
              · {r.service} · {dayFormat.format(new Date(r.createdAt))}
            </p>
            {r.comment && <p>{r.comment}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
