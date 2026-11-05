'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { type AlertsState, alertsState, forgetAlerts, turnOnAlerts } from '@/lib/alerts';
import { loadMe, useSession } from '@/lib/useSession';
import { AccountShell } from './AccountShell';
import { SignedOut } from './SignedOut';

export function SettingsPage() {
  const router = useRouter();
  const { me, loading } = useSession();
  const [alerts, setAlerts] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (me) alertsState().then(setAlerts, () => setAlerts('off'));
  }, [me]);

  async function signOut(everywhere: boolean) {
    setBusy(everywhere ? 'everywhere' : 'here');
    await forgetAlerts();
    await post(everywhere ? '/v1/me/sign-out-everywhere' : '/v1/auth/logout').catch(
      () => undefined,
    );
    await loadMe(true);
    router.replace('/');
    router.refresh();
  }

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) return <SignedOut next="/account/settings" title="Settings" />;

  return (
    <AccountShell>
      <h1 className="page-title">Settings</h1>

      <section className="panel">
        <h2 className="panel-title">Alerts on this device</h2>
        <p className="meta">
          Pop-up alerts for{' '}
          {me.role === 'PRO'
            ? 'new requests, messages, calls and payments.'
            : 'your Pro accepting, messages, calls and visits.'}{' '}
          The most important ones also come by SMS.
        </p>
        {message && (
          <p className="alert alert-info" role="status">
            {message}
          </p>
        )}
        {alerts === 'on' && (
          <div className="setting-row">
            <span className="status-pill status-on">On</span>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('alerts');
                await forgetAlerts();
                setAlerts('off');
                setMessage('Alerts are off on this device.');
                setBusy(null);
              }}
            >
              Turn off
            </button>
          </div>
        )}
        {alerts === 'off' && (
          <div className="setting-row">
            <span className="status-pill">Off</span>
            <button
              className="button button-small"
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('alerts');
                try {
                  const next = await turnOnAlerts();
                  setAlerts(next);
                  setMessage(next === 'on' ? 'Alerts are on.' : null);
                } catch {
                  setMessage('Alerts could not be turned on. Try again.');
                }
                setBusy(null);
              }}
            >
              Turn on
            </button>
          </div>
        )}
        {alerts === 'blocked' && (
          <p className="meta">
            Alerts are blocked for GADMO in this browser’s settings. Allow notifications for this
            site, then come back here.
          </p>
        )}
        {alerts === 'unsupported' && (
          <p className="meta">
            This browser can’t show alerts. On iPhone, add GADMO to your home screen first.
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Language</h2>
        <div className="field">
          <label htmlFor="language">App language</label>
          <select id="language" defaultValue="en" disabled>
            <option value="en">English</option>
          </select>
          <span className="hint">Pidgin and Yoruba are coming soon.</span>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Signing in</h2>
        <p className="meta">
          You sign in with a code sent to your phone. If you used GADMO on a phone or computer you
          no longer have, sign out everywhere: every device will need a new code.
        </p>
        <div className="fee-actions">
          <button
            className="button button-quiet button-small"
            type="button"
            disabled={busy !== null}
            onClick={() => signOut(false)}
          >
            Sign out
          </button>
          <button
            className="button button-quiet button-small"
            type="button"
            disabled={busy !== null}
            onClick={() => signOut(true)}
          >
            Sign out everywhere
          </button>
        </div>
      </section>
    </AccountShell>
  );
}
