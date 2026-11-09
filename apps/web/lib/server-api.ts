import 'server-only';
import type { CategoryGroup, TopPro } from './types';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The public catalogue, fetched on the server so the home page arrives as plain HTML
 * (no extra request or JavaScript on the phone). Returns null if the API is unreachable.
 */
export async function getCatalogue(): Promise<CategoryGroup[] | null> {
  try {
    // Always fresh: a cached copy could carry IDs from an older database.
    const res = await fetch(`${API_URL}/v1/categories`, { cache: 'no-store' });
    if (!res.ok) return null;
    return ((await res.json()) as { groups: CategoryGroup[] }).groups;
  } catch {
    return null;
  }
}

/** A few top-rated verified Pros for the home page; empty if none or the API is down. */
export async function getTopPros(): Promise<TopPro[]> {
  try {
    const res = await fetch(`${API_URL}/v1/pros/top`, { cache: 'no-store' });
    if (!res.ok) return [];
    return ((await res.json()) as { pros: TopPro[] }).pros;
  } catch {
    return [];
  }
}
