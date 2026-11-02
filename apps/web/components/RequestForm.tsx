'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import type { Category } from '@/lib/types';
import { useSession } from '@/lib/useSession';

/** Used only when the phone cannot share its location; Pros confirm the exact spot in chat. */
const ADO_EKITI_CENTRE = { latitude: 7.6233, longitude: 5.2209 };

type Place =
  | { kind: 'none' }
  | { kind: 'locating' }
  | { kind: 'gps'; latitude: number; longitude: number }
  | { kind: 'town'; latitude: number; longitude: number };

export function RequestForm({
  category,
  startUrgent,
}: {
  category: Category;
  startUrgent: boolean;
}) {
  const router = useRouter();
  const { me, loading } = useSession();
  const [urgent, setUrgent] = useState(startUrgent);
  const [when, setWhen] = useState('');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState<Place>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const here = `/request?service=${category.slug}${startUrgent ? '&urgent=1' : ''}`;

  if (loading) return <p className="meta">Loading…</p>;

  if (!me) {
    return (
      <>
        <p className="alert alert-info">Sign in with your phone number to send this request.</p>
        <Link className="button" href={`/signin?next=${encodeURIComponent(here)}`}>
          Sign in to continue
        </Link>
      </>
    );
  }

  if (me.role !== 'CUSTOMER') {
    return (
      <p className="alert alert-info">
        You’re signed in as a Pro. Requesting services from a Pro account isn’t available yet. Pro
        tools (jobs near you, quotes and payouts) are coming next.
      </p>
    );
  }

  function locate() {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This phone cannot share its location. Choose Ado-Ekiti instead.');
      return;
    }
    setPlace({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setPlace({ kind: 'gps', latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => {
        setPlace({ kind: 'none' });
        setError('Location was not shared. Allow location access, or choose Ado-Ekiti instead.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 10) {
      setError('Describe the job in a few words (at least 10 characters).');
      return;
    }
    if (place.kind !== 'gps' && place.kind !== 'town') {
      setError('Share your location so nearby Pros can find you.');
      return;
    }
    if (!urgent && !when) {
      setError('Choose a date and time.');
      return;
    }
    setBusy(true);
    try {
      await post('/v1/jobs', {
        categoryId: category.id,
        type: urgent ? 'EMERGENCY' : 'SCHEDULED',
        description: description.trim(),
        latitude: place.latitude,
        longitude: place.longitude,
        ...(urgent ? {} : { scheduledAt: new Date(when).toISOString() }),
      });
      router.push('/jobs?sent=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your request. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      {category.emergencyEnabled && (
        <fieldset className="fieldset">
          <legend className="legend">When do you need help?</legend>
          <label className="choice">
            <input type="radio" name="when" checked={urgent} onChange={() => setUrgent(true)} />
            <span>
              <strong>Right now</strong>
              We alert the nearest available Pros immediately.
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="when" checked={!urgent} onChange={() => setUrgent(false)} />
            <span>
              <strong>Pick a date and time</strong>
              For work that can wait.
            </span>
          </label>
        </fieldset>
      )}

      {!urgent && (
        <div className="field">
          <label htmlFor="when">Date and time</label>
          <input
            id="when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="description">
          What do you need done?
          <span className="hint">
            Don’t include phone numbers. You’ll chat with the Pro inside GADMO.
          </span>
        </label>
        <textarea
          id="description"
          maxLength={1000}
          placeholder="e.g. Kitchen tap is leaking and won’t turn off"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <fieldset className="fieldset">
        <legend className="legend">
          Where?
          <span className="hint">
            Your exact address is shared only after you pay the agreed inspection fee.
          </span>
        </legend>
        <button
          type="button"
          className="button button-quiet"
          onClick={locate}
          disabled={place.kind === 'locating'}
        >
          {place.kind === 'locating'
            ? 'Finding you…'
            : place.kind === 'gps'
              ? '✓ Using your current location'
              : 'Use my current location'}
        </button>
        <label className="choice button-spaced">
          <input
            type="radio"
            name="place"
            checked={place.kind === 'town'}
            onChange={() => setPlace({ kind: 'town', ...ADO_EKITI_CENTRE })}
          />
          <span>
            <strong>Somewhere in Ado-Ekiti</strong>
            Confirm the exact spot with the Pro in chat.
          </span>
        </label>
      </fieldset>

      <button className="button" type="submit" disabled={busy}>
        {busy ? 'Sending…' : urgent ? 'Get help now' : 'Send request'}
      </button>
    </form>
  );
}
