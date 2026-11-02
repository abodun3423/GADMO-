'use client';

import Link from 'next/link';
import { useSession } from '@/lib/useSession';

/** Top-right link: "Sign in" when signed out, "My jobs" when signed in. */
export function AccountLink() {
  const { me, loading } = useSession();
  if (loading) return <span className="topbar-link" aria-hidden="true" />;
  return me ? (
    <Link href="/jobs" className="topbar-link">
      My jobs
    </Link>
  ) : (
    <Link href="/signin" className="topbar-link">
      Sign in
    </Link>
  );
}
