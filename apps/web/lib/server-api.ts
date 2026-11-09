import 'server-only';
import { apiBase } from './api-base';
import type { CategoryGroup, TopPro } from './types';

/** How long to keep trying an API that doesn't answer: it takes up to a minute to wake. */
const WAIT_MS = 60_000;

/**
 * GETs a public API path as JSON, trying again for about a minute if the API doesn't
 * answer. On a free host the API sleeps when idle and takes up to a minute to wake;
 * a page should wait for it, not show an error.
 */
async function getJson<T>(path: string): Promise<T | null> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      // Always fresh: a cached copy could carry IDs from an older database.
      const res = await fetch(`${apiBase()}${path}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500) return null; // a real answer, not a waking server
    } catch {
      // Not reachable yet (asleep, restarting): try again.
    }
    if (Date.now() + 2000 > deadline) return null;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/**
 * The last good copy, kept in this server's memory. If the API can't be reached at all,
 * the home page still shows the services from it instead of an error.
 */
let lastCatalogue: CategoryGroup[] | null = null;
let lastTopPros: TopPro[] = [];

/**
 * The public catalogue, fetched on the server so the home page arrives as plain HTML
 * (no extra request or JavaScript on the phone). Null only if the API has never answered.
 */
export async function getCatalogue(): Promise<CategoryGroup[] | null> {
  const res = await getJson<{ groups: CategoryGroup[] }>('/v1/categories');
  if (res) lastCatalogue = res.groups;
  return res?.groups ?? lastCatalogue;
}

/** A few top-rated verified Pros for the home page; the last good list, or empty. */
export async function getTopPros(): Promise<TopPro[]> {
  const res = await getJson<{ pros: TopPro[] }>('/v1/pros/top');
  if (res) lastTopPros = res.pros;
  return res?.pros ?? lastTopPros;
}
