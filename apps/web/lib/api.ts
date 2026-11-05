/**
 * Browser-side API client. Calls go to the same origin (/v1/*, proxied to the API), so
 * the httpOnly login cookies are sent automatically. Every state-changing call carries
 * the CSRF header, and an expired 15-minute session is refreshed once, transparently.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function send(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (UNSAFE.has(method)) headers.set('x-gadmo-client', 'web');
  return fetch(path, { ...init, method, headers, credentials: 'same-origin' });
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit an expired session. */
function refreshSession(): Promise<boolean> {
  refreshing ??= send('/v1/auth/refresh', { method: 'POST' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  if (status === 429) return 'Too many attempts. Please wait a few minutes and try again.';
  if (status >= 500) return 'GADMO is having trouble right now. Please try again shortly.';
  return 'Something went wrong. Please try again.';
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith('/v1/auth/')) {
    if (await refreshSession()) res = await send(path, init);
  }
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status), body);
  return body as T;
}

export const post = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

export const patch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });

/** The first field message from a 400 "Validation failed" response, if there is one. */
export function fieldMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const issues = (err.body as { issues?: { message?: unknown }[] } | undefined)?.issues;
  const first = issues?.[0]?.message;
  return typeof first === 'string' ? first : null;
}

export const put = <T>(path: string, data: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(data) });

/** Sends a photo as raw bytes (PUT), e.g. for the identity check. */
export const putImage = (path: string, image: Blob) =>
  api<void>(path, { method: 'PUT', body: image, headers: { 'content-type': image.type } });

/** Sends a photo or voice note as raw bytes (POST) and returns the API's answer. */
export const postBlob = <T>(path: string, blob: Blob) =>
  api<T>(path, {
    method: 'POST',
    body: blob,
    headers: { 'content-type': blob.type.split(';')[0]! },
  });
