'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, fieldMessage, post } from '@/lib/api';
import { localPhone } from '@/lib/format';
import type { SkillCheckDetail, SkillCheckResult } from '@/lib/types';
import { StaffOnly } from './StaffOnly';

const RESULT_TEXT: Record<SkillCheckResult, string> = {
  PENDING: 'Waiting for the visit',
  PASSED: 'Passed',
  FAILED: 'Not passed',
};

const dateFormat = new Intl.DateTimeFormat('en-NG', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Africa/Lagos',
});

/** "2026-11-20T10:00" in Lagos time, for a datetime-local field, from an ISO time. */
function toLagosInput(iso: string): string {
  const lagos = new Date(new Date(iso).getTime() + 60 * 60 * 1000);
  return lagos.toISOString().slice(0, 16);
}

export function SkillCheckVisit({ id }: { id: string }) {
  return (
    <StaffOnly next={`/admin/skill-checks/${id}`}>
      <Visit id={id} />
    </StaffOnly>
  );
}

function Visit({ id }: { id: string }) {
  const router = useRouter();
  const [check, setCheck] = useState<SkillCheckDetail | null>(null);
  const [when, setWhen] = useState('');
  const [place, setPlace] = useState('');
  const [result, setResult] = useState<'PASSED' | 'FAILED' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ skillCheck: SkillCheckDetail }>(`/v1/admin/skill-checks/${id}`);
      setCheck(r.skillCheck);
      if (r.skillCheck.scheduledAt) setWhen(toLagosInput(r.skillCheck.scheduledAt));
      if (r.skillCheck.visitPlace) setPlace(r.skillCheck.visitPlace);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'This skill check does not exist.'
          : 'This skill check could not be loaded. Check your connection and refresh.',
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function book(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (!when || place.trim().length < 3) {
      setError('Choose a date and time, and say where the agent will go.');
      return;
    }
    setBusy(true);
    try {
      // The field is Lagos time (UTC+1, no daylight saving).
      await post(`/v1/admin/skill-checks/${id}/schedule`, {
        scheduledAt: `${when}:00+01:00`,
        visitPlace: place,
      });
      setSaved('Visit booked. The Pro sees the time and place.');
      await load();
    } catch (err) {
      setError(
        fieldMessage(err) ?? (err instanceof ApiError ? err.message : 'Could not save. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function record(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (!result) {
      setError('Choose passed or not passed.');
      return;
    }
    if (note.trim().length < 5) {
      setError('Say what you saw (at least a few words).');
      return;
    }
    setBusy(true);
    try {
      await post(`/v1/admin/skill-checks/${id}/result`, { result, note });
      router.push(`/admin/skill-checks?done=${result}`);
    } catch (err) {
      setError(
        fieldMessage(err) ?? (err instanceof ApiError ? err.message : 'Could not save. Try again.'),
      );
      setBusy(false);
    }
  }

  return (
    <>
      <p className="meta">
        <Link href="/admin/skill-checks">← All skill checks</Link>
      </p>
      <h1 className="page-title">{check?.proName ?? (check ? 'No name yet' : 'Skill check')}</h1>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="alert alert-info" role="status">
          {saved}
        </p>
      )}
      {!check && !error && <p className="meta">Loading…</p>}

      {check && (
        <>
          <dl className="details">
            <div>
              <dt>Phone</dt>
              <dd>
                <a href={`tel:${check.proPhone}`}>{localPhone(check.proPhone)}</a>
              </dd>
            </div>
            <div>
              <dt>Skills</dt>
              <dd>{check.skills.length ? check.skills.join(', ') : 'None yet'}</dd>
            </div>
            <div>
              <dt>Learned at</dt>
              <dd>
                {check.trainedAt ?? 'Not given'}
                {check.trainedBy && <span className="hint">Trained by {check.trainedBy}</span>}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                {RESULT_TEXT[check.result]}
                {check.scheduledAt && (
                  <span className="hint">
                    Visit: {dateFormat.format(new Date(check.scheduledAt))}
                    {check.visitPlace ? `, ${check.visitPlace}` : ''}
                  </span>
                )}
                {check.note && <span className="hint">Agent’s note: {check.note}</span>}
              </dd>
            </div>
            {check.history.length > 0 && (
              <div>
                <dt>Earlier checks</dt>
                <dd>
                  {check.history.map((h) => (
                    <span key={h.id} className="hint">
                      {RESULT_TEXT[h.result]}
                      {h.checkedAt ? ` on ${dateFormat.format(new Date(h.checkedAt))}` : ''}
                      {h.note ? `. “${h.note}”` : ''}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {check.result === 'PENDING' && (
            <>
              <form onSubmit={book} noValidate className="decision">
                <h2 className="section-title">
                  {check.scheduledAt ? 'Move the visit' : 'Book the visit'}
                </h2>
                <div className="field">
                  <label htmlFor="visit-when">
                    Date and time
                    <span className="hint">Lagos time. Call the Pro first to agree it.</span>
                  </label>
                  <input
                    id="visit-when"
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="visit-place">
                    Where
                    <span className="hint">
                      The Pro’s workshop or a past job site. The Pro sees this.
                    </span>
                  </label>
                  <input
                    id="visit-place"
                    type="text"
                    maxLength={200}
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                    placeholder="e.g. His workshop, Ajilosun, Ado-Ekiti"
                  />
                </div>
                <button className="button button-quiet" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save visit'}
                </button>
              </form>

              <form onSubmit={record} noValidate className="decision">
                <fieldset className="fieldset">
                  <legend className="legend">After the visit</legend>
                  {(
                    [
                      ['PASSED', 'Passed', 'Right tools, a good demonstration and real past work.'],
                      [
                        'FAILED',
                        'Not passed',
                        'Could not show the skill, or the tools or past work were not theirs.',
                      ],
                    ] as const
                  ).map(([value, title, text]) => (
                    <label key={value} className="choice">
                      <input
                        type="radio"
                        name="result"
                        value={value}
                        checked={result === value}
                        onChange={() => setResult(value)}
                      />
                      <span>
                        <strong>{title}</strong>
                        {text}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="field">
                  <label htmlFor="visit-note">
                    What you saw
                    <span className="hint">
                      Kept on record. If not passed, the Pro sees this, so say what to improve.
                    </span>
                  </label>
                  <textarea
                    id="visit-note"
                    maxLength={1000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <button className="button" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save result'}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </>
  );
}
