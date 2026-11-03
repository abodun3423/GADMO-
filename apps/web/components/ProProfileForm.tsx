'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError, fieldMessage, put } from '@/lib/api';
import { ADO_EKITI_CENTRE } from '@/lib/places';
import type { CategoryGroup, ProProfile } from '@/lib/types';
import { useSession } from '@/lib/useSession';

const MAX_SKILLS = 10;
const RADIUS_KM = [5, 10, 20, 30, 50];

type Place =
  | { kind: 'saved' | 'gps' | 'town'; latitude: number; longitude: number }
  | { kind: 'locating' }
  | { kind: 'none' };

export function ProProfileForm({ groups }: { groups: CategoryGroup[] }) {
  const { me, loading } = useSession();
  const [profile, setProfile] = useState<ProProfile | null>(null);
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [bio, setBio] = useState('');
  const [place, setPlace] = useState<Place>({ kind: 'none' });
  const [radius, setRadius] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** Groups holding saved skills start open; after that the Pro opens and closes them. */
  const [openAtLoad, setOpenAtLoad] = useState<Set<string>>(new Set());

  const allSkills = useMemo(() => groups.flatMap((g) => g.categories), [groups]);
  const names = useMemo(() => new Map(allSkills.map((c) => [c.id, c.name])), [allSkills]);

  useEffect(() => {
    if (me?.role !== 'PRO') return;
    api<{ profile: ProProfile }>('/v1/pro/profile')
      .then(({ profile: p }) => {
        setProfile(p);
        setSkills(new Set(p.categoryIds));
        setOpenAtLoad(
          new Set(
            groups
              .filter((g) => g.categories.some((c) => p.categoryIds.includes(c.id)))
              .map((g) => g.id),
          ),
        );
        setBio(p.bio);
        setRadius(p.serviceRadiusKm);
        if (p.latitude !== null && p.longitude !== null) {
          setPlace({ kind: 'saved', latitude: p.latitude, longitude: p.longitude });
        }
      })
      .catch(() =>
        setError('Your profile could not be loaded. Check your connection and refresh.'),
      );
  }, [me, groups]);

  function toggle(id: string) {
    setSaved(false);
    setError(null);
    setSkills((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SKILLS) next.add(id);
      return next;
    });
  }

  function locate() {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('This device cannot share its location. Choose Ado-Ekiti instead.');
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
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (skills.size === 0) {
      setError('Choose at least one skill.');
      return;
    }
    if (place.kind === 'none' || place.kind === 'locating') {
      setError('Choose where you work from.');
      return;
    }
    setBusy(true);
    try {
      const { profile: p } = await put<{ profile: ProProfile }>('/v1/pro/profile', {
        categoryIds: [...skills],
        bio,
        latitude: place.latitude,
        longitude: place.longitude,
        serviceRadiusKm: radius,
      });
      setProfile(p);
      setBio(p.bio);
      setSaved(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(
        fieldMessage(err) ??
          (err instanceof ApiError ? err.message : 'Could not save. Check your connection.'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="meta">Loading…</p>;

  if (!me) {
    return (
      <>
        <h1 className="page-title">Your Pro profile</h1>
        <p className="lede">Sign in with your Pro account to set up your profile.</p>
        <Link className="button" href="/signin?next=%2Fpro%2Fprofile">
          Sign in
        </Link>
      </>
    );
  }

  if (me.role !== 'PRO') {
    return (
      <>
        <h1 className="page-title">Your Pro profile</h1>
        <p className="lede">
          This page is for Pros. You’re signed in with a customer account, which is for booking
          skilled people.
        </p>
        <Link className="button" href="/">
          Find a service
        </Link>
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = q ? allSkills.filter((c) => c.name.toLowerCase().includes(q)) : [];
  const full = skills.size >= MAX_SKILLS;

  const skillBox = (id: string, name: string) => (
    <li key={id}>
      <label className="check">
        <input
          type="checkbox"
          checked={skills.has(id)}
          disabled={full && !skills.has(id)}
          onChange={() => toggle(id)}
        />
        <span>{name}</span>
      </label>
    </li>
  );

  return (
    <>
      <h1 className="page-title">Your Pro profile</h1>
      <p className="lede">Tell customers what you do and where you work.</p>

      {saved && (
        <div className="alert alert-info" role="status">
          <strong>Profile saved.</strong>
          {profile?.verificationStatus !== 'APPROVED' && (
            <>
              {' '}
              Next: a quick identity check (NIN and a selfie). It’s coming soon. Once you’re
              verified you can go online and receive jobs near you.
            </>
          )}{' '}
          <Link href="/pro">Go to Pro home</Link>
        </div>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!profile && !error && <p className="meta">Loading your profile…</p>}

      {profile && (
        <form onSubmit={save} noValidate>
          <fieldset className="fieldset">
            <legend className="legend">
              What do you do?
              <span className="hint">
                Choose up to {MAX_SKILLS}. You’ll get jobs for these services.
              </span>
            </legend>

            <p className="selected" aria-live="polite">
              {skills.size === 0
                ? 'No skills chosen yet.'
                : `${skills.size} chosen: ${[...skills].map((id) => names.get(id) ?? 'Skill').join(', ')}`}
            </p>

            <label htmlFor="skill-search" className="sr-only">
              Search skills
            </label>
            <input
              id="skill-search"
              type="search"
              placeholder="Search, e.g. electrician, baker"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {q ? (
              <ul className="checks">
                {matches.length === 0 ? (
                  <li className="empty">No skill matches “{query.trim()}”.</li>
                ) : (
                  matches.map((c) => skillBox(c.id, c.name))
                )}
              </ul>
            ) : (
              <div className="groups groups-plain">
                {groups.map((g) => {
                  const chosen = g.categories.filter((c) => skills.has(c.id)).length;
                  return (
                    <details key={g.id} className="group" open={openAtLoad.has(g.id) || undefined}>
                      <summary>
                        {g.name}
                        <span className="count">{chosen > 0 ? `${chosen} chosen` : ''}</span>
                      </summary>
                      <ul className="checks">{g.categories.map((c) => skillBox(c.id, c.name))}</ul>
                    </details>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="field">
            <label htmlFor="bio">
              About you{' '}
              <span className="hint">Optional. Experience, tools, what you’re good at.</span>
            </label>
            <textarea
              id="bio"
              maxLength={500}
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setSaved(false);
              }}
              placeholder="e.g. Electrician for 8 years. Wiring, sockets, inverter installation."
            />
            <span className="hint">
              Phone numbers, emails and social handles are hidden. Customers talk to you in GADMO
              chat.
            </span>
          </div>

          <fieldset className="fieldset">
            <legend className="legend">
              Where do you work from?
              <span className="hint">
                We send you jobs near this place. Customers never see your exact location.
              </span>
            </legend>
            <button
              className="button button-quiet button-gap"
              type="button"
              onClick={locate}
              disabled={place.kind === 'locating'}
            >
              {place.kind === 'locating' ? 'Finding you…' : 'Use my current location'}
            </button>
            <label className="choice">
              <input
                type="radio"
                name="place"
                checked={place.kind === 'town'}
                onChange={() => setPlace({ kind: 'town', ...ADO_EKITI_CENTRE })}
              />
              <span>
                <strong>Ado-Ekiti</strong>
                Town centre
              </span>
            </label>
            <p className="meta" aria-live="polite">
              {place.kind === 'gps' && 'Using your current location.'}
              {place.kind === 'saved' && 'Using the place you saved before.'}
              {place.kind === 'town' && 'Using Ado-Ekiti town centre.'}
              {place.kind === 'none' && 'Not set yet.'}
            </p>

            <div className="field">
              <label htmlFor="radius">How far will you travel?</label>
              <select
                id="radius"
                value={radius}
                onChange={(e) => {
                  setRadius(Number(e.target.value));
                  setSaved(false);
                }}
              >
                {RADIUS_KM.map((km) => (
                  <option key={km} value={km}>
                    Up to {km} km
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      )}
    </>
  );
}
