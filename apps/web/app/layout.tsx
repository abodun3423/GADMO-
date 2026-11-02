import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { AccountLink } from '@/components/AccountLink';
import { ServiceWorker } from '@/components/ServiceWorker';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'GADMO: The Right Skills. Within Reach.', template: '%s | GADMO' },
  description:
    'Find verified electricians, plumbers, mechanics, tutors, bakers and more near you in Ekiti.',
  applicationName: 'GADMO',
  appleWebApp: { capable: true, title: 'GADMO', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#1f2a6b',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is rendered per request so it can carry this request's CSP nonce.
  await connection();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="wordmark" aria-label="GADMO home">
            GADMO
          </Link>
          <AccountLink />
        </header>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
