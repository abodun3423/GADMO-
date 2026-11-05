import type { NextConfig } from 'next';

// The browser never talks to the API directly: /v1/* is forwarded by app/v1/[...path]/route.ts
// to API_URL, read at runtime so one build works in every environment.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The shared package is plain CommonJS; let Next bundle only the parts each page imports.
  transpilePackages: ['@gadmo/shared'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      {
        // The service worker must always be re-checked so updates reach users quickly.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
