import { api, post } from './api';

/**
 * Alerts (web push) for this browser. iPhones support them only once GADMO is added to the
 * home screen; SMS covers the most important moments either way.
 */
export type AlertsState = 'unsupported' | 'blocked' | 'off' | 'on';

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function save(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await post('/v1/push/subscriptions', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  });
}

/** Where this browser stands; if already on, re-saves it for the signed-in account. */
export async function alertsState(): Promise<AlertsState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub || Notification.permission !== 'granted') return 'off';
  await save(sub).catch(() => undefined);
  return 'on';
}

/** Asks the browser, subscribes, and tells GADMO. */
export async function turnOnAlerts(): Promise<AlertsState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const { publicKey } = await api<{ publicKey: string | null }>('/v1/push/key');
  if (!publicKey) return 'unsupported';
  const reg = (await registration()) ?? (await navigator.serviceWorker.ready);
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await save(sub);
  return 'on';
}

/** On sign-out: this browser stops getting the account's alerts. */
export async function forgetAlerts(): Promise<void> {
  try {
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await api('/v1/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  } catch {
    // Signing out must still work.
  }
}
