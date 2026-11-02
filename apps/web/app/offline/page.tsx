import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'You’re offline' };

export default function OfflinePage() {
  return (
    <main className="page">
      <h1 className="page-title">You’re offline</h1>
      <p className="lede">
        GADMO needs a connection to find Pros and send requests. Check your data or Wi-Fi, then try
        again.
      </p>
      <a className="button" href="/">
        Try again
      </a>
    </main>
  );
}
