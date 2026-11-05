'use client';

import Link from 'next/link';
import { useSession } from '@/lib/useSession';
import { initials } from './account/AccountShell';

/**
 * Top-right links: "Sign in" when signed out. Signed in: customers get "My jobs",
 * Pros get "Pro home"; everyone gets "Account".
 */
export function AccountLink() {
  const { me, loading } = useSession();
  if (loading) return <span className="topbar-link" aria-hidden="true" />;
  if (!me) {
    return (
      <Link href="/signin" className="topbar-link">
        Sign in
      </Link>
    );
  }
  return (
    <nav className="topbar-nav" aria-label="Your GADMO">
      {me.role === 'ADMIN' || me.role === 'SUPER_ADMIN' ? (
        <Link href="/admin" className="topbar-link">
          Dashboard
        </Link>
      ) : me.role === 'PRO' ? (
        <Link href="/pro" className="topbar-link">
          Pro home
        </Link>
      ) : (
        <Link href="/jobs" className="topbar-link">
          My jobs
        </Link>
      )}
      {me.role === 'CUSTOMER' || me.role === 'PRO' ? (
        <Link href="/account" className="topbar-avatar" aria-label="Account">
          <span className="avatar" aria-hidden="true">
            {initials(me.name)}
          </span>
        </Link>
      ) : (
        <Link href="/account" className="topbar-link">
          Account
        </Link>
      )}
    </nav>
  );
}
