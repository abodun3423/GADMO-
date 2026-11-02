'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Me } from './types';

let cached: Promise<Me | null> | null = null;
const listeners = new Set<(me: Me | null) => void>();

/**
 * Loads the signed-in user once per page load. Call with force=true after signing in or
 * out: every component using useSession (like the top bar) then updates. null = signed out.
 */
export function loadMe(force = false): Promise<Me | null> {
  if (force || !cached) {
    const request = api<{ user: Me }>('/v1/auth/me')
      .then((r) => r.user)
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      });
    cached = request;
    if (force) {
      request.then((me) => listeners.forEach((notify) => notify(me))).catch(() => undefined);
    }
  }
  return cached;
}

export function useSession() {
  const [state, setState] = useState<{ me: Me | null; loading: boolean }>({
    me: null,
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    const update = (me: Me | null) => alive && setState({ me, loading: false });
    listeners.add(update);
    loadMe()
      .then(update)
      .catch(() => update(null));
    return () => {
      alive = false;
      listeners.delete(update);
    };
  }, []);
  return state;
}
