/**
 * Runs once when the web server starts. In production it pings the API now and every
 * 10 minutes, so the API is awake whenever the web app is. On free hosting each service
 * sleeps on its own after 15 idle minutes; without this, the first visitor after a quiet
 * spell would wake the web app and then wait again for the API.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const { apiBase } = await import('./lib/api-base');
  const ping = () =>
    fetch(`${apiBase()}/health`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) }).catch(
      () => undefined,
    );
  void ping();
  setInterval(() => void ping(), 10 * 60 * 1000).unref();
}
