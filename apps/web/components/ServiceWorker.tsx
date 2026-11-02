'use client';

import { useEffect } from 'react';

/** Registers the offline-ready service worker (production builds only). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  }, []);
  return null;
}
