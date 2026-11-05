'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker: offline support and alerts in production; alerts only
 * (no caching) during development.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const url = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1';
    navigator.serviceWorker.register(url, { scope: '/' }).catch(() => {
      // Offline support is a bonus; the app works without it.
    });
  }, []);
  return null;
}
