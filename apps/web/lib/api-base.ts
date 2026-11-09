/**
 * Where the web server reaches the GADMO API (server side only; the browser never does).
 * API_URL in development and tests; on Render, the private API service's API_HOSTPORT
 * (host:port on Render's private network).
 */
export function apiBase(): string {
  if (process.env.API_URL) return process.env.API_URL;
  if (process.env.API_HOSTPORT) return `http://${process.env.API_HOSTPORT}`;
  return 'http://localhost:4000';
}
