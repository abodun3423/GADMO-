'use client';

import Link from 'next/link';
import { useSession } from '@/lib/useSession';

/** Top-right links: "Sign in" when signed out; "My jobs" and "Account" when signed in. */
export function AccountLink() {
  const { me, loading } = useSession();
  if (loading) return <span className="topbar-link" aria-hidden="true" />;
  return me ? (
    <nav className="topbar-nav" aria-label="Your GADMO">
      <Link href="/jobs" className="topbar-link">
        My jobs
      </Link>
      <Link href="/account" className="topbar-link">
        Account
      </Link>
    </nav>
  ) : (
    <Link href="/signin" className="topbar-link">
      Sign in
    </Link>
  );
}
