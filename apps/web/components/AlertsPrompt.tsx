'use client';

import { useEffect, useState } from 'react';
import { type AlertsState, alertsState, turnOnAlerts } from '@/lib/alerts';

/** Invites the signed-in person to turn on alerts, or says where they stand. */
export function AlertsPrompt({ why }: { why: string }) {
  const [state, setState] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    alertsState()
      .then(setState)
      .catch(() => setState('off'));
  }, []);

  if (state === null || state === 'on') return null;
  if (state === 'unsupported') {
    return (
      <p className="alerts-note meta">
        This browser can’t show GADMO alerts. On iPhone, add GADMO to your home screen first. You’ll
        still get an SMS for the most important updates.
      </p>
    );
  }
  if (state === 'blocked') {
    return (
      <p className="alerts-note meta">
        Alerts are blocked for GADMO in this browser’s settings. You’ll still get an SMS for the
        most important updates.
      </p>
    );
  }
  return (
    <div className="alerts-prompt" role="region" aria-label="Alerts">
      <p>
        <strong>Turn on alerts</strong> {why}
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-small"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setState(await turnOnAlerts());
          } catch {
            setError('Alerts could not be turned on. Try again.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Turning on…' : 'Turn on alerts'}
      </button>
    </div>
  );
}
