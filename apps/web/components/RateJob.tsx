'use client';

import { useEffect, useState } from 'react';
import { api, fieldMessage, post } from '@/lib/api';
import type { JobReview } from '@/lib/types';

const dayFormat = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Africa/Lagos',
});

/** "★★★★☆" for 4 stars. */
export function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

/**
 * After a job is complete, each side rates the other once, within 14 days (founder
 * decision). The customer's rating shows on the Pro's profile without the customer's name;
 * the Pro's rating of the customer is seen only by GADMO staff.
 */
export function RateJob({ jobId }: { jobId: string }) {
  const [review, setReview] = useState<JobReview | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ review: JobReview }>(`/v1/jobs/${jobId}/review`)
      .then((r) => live && setReview(r.review))
      .catch(() => live && setReview(null));
    return () => {
      live = false;
    };
  }, [jobId]);

  if (!review) return null;
  const aboutPro = review.subject === 'PRO';

  if (review.mine) {
    return (
      <p className="meta rate-done">
        You rated this {aboutPro ? 'Pro' : 'customer'}{' '}
        <span aria-label={`${review.mine.rating} out of 5 stars`}>{stars(review.mine.rating)}</span>
        . Thank you.
      </p>
    );
  }
  if (!review.canReview) return null;

  async function send() {
    if (rating === 0) {
      setError('Choose from 1 to 5 stars.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await post<{ review: JobReview }>(`/v1/jobs/${jobId}/review`, {
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setReview({ ...review!, ...saved.review });
    } catch (err) {
      setError(fieldMessage(err) ?? (err instanceof Error ? err.message : 'Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rate-job"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <fieldset className="star-input">
        <legend>
          {aboutPro ? 'How did your Pro do?' : 'How was this customer?'}
          <span className="hint">
            {aboutPro
              ? 'Your rating helps other customers choose. Your name is not shown with it.'
              : 'Only GADMO staff see this. It helps keep GADMO safe for Pros.'}
          </span>
        </legend>
        <div className="star-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= rating ? 'star star-on' : 'star'}>
              <input
                type="radio"
                name="rating"
                value={n}
                className="sr-only"
                checked={rating === n}
                onChange={() => {
                  setRating(n);
                  setError(null);
                }}
              />
              <span aria-hidden="true">★</span>
              <span className="sr-only">
                {n} {n === 1 ? 'star' : 'stars'}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="rate-comment">
          {aboutPro ? 'Tell other customers about the work' : 'Anything staff should know'}{' '}
          <span className="hint">Optional</span>
        </label>
        <textarea
          id="rate-comment"
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="fee-actions">
        <button className="button" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send rating'}
        </button>
      </div>
      {review.until && (
        <p className="meta">You can rate until {dayFormat.format(new Date(review.until))}.</p>
      )}
    </form>
  );
}
