import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { AccountLink } from '@/components/AccountLink';
import { Logo } from '@/components/Logo';
import { ServiceWorker } from '@/components/ServiceWorker';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'GADMO: The Right Skills. Within Reach.', template: '%s | GADMO' },
  description:
    'Find verified electricians, plumbers, mechanics, tutors, bakers and more near you in Ekiti.',
  applicationName: 'GADMO',
  appleWebApp: { capable: true, title: 'GADMO', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#10163f',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page is rendered per request so it can carry this request's CSP nonce.
  await connection();
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/fonts/bricolage-grotesque.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
      </head>
      <body>
        <div className="topbar-band">
          <header className="topbar">
            <Link href="/" className="wordmark" aria-label="GADMO home">
              <Logo />
            </Link>
            <AccountLink />
          </header>
        </div>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
