'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { post } from '@/lib/api';
import { loadMe, useSession } from '@/lib/useSession';

/** Renders children only for GADMO staff; everyone else is pointed to the staff sign-in. */
export function StaffOnly({ next, children }: { next: string; children: ReactNode }) {
  const router = useRouter();
  const { me, loading } = useSession();
  const staffSignIn = `/staff?next=${encodeURIComponent(next)}`;

  async function switchAccount() {
    await post('/v1/auth/logout').catch(() => undefined);
    await loadMe(true);
    router.replace(staffSignIn);
  }

  if (loading) return <p className="meta">Loading…</p>;
  if (!me) {
    return (
      <>
        <h1 className="page-title">GADMO staff</h1>
        <p className="lede">Sign in with a staff account.</p>
        <Link className="button" href={staffSignIn}>
          Sign in
        </Link>
      </>
    );
  }
  if (me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') {
    return (
      <>
        <h1 className="page-title">GADMO staff</h1>
        <p className="lede">
          This page is for GADMO staff only. You’re signed in with your{' '}
          {me.role === 'PRO' ? 'Pro' : 'customer'} account.
        </p>
        <button className="button" type="button" onClick={switchAccount}>
          Sign out and go to staff sign-in
        </button>
        <Link className="button button-quiet button-spaced" href={me.role === 'PRO' ? '/pro' : '/'}>
          Back to {me.role === 'PRO' ? 'Pro home' : 'GADMO'}
        </Link>
      </>
    );
  }
  return <>{children}</>;
}
