'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/useSession';

/** Renders children only for GADMO staff; everyone else gets a plain message. */
export function StaffOnly({ next, children }: { next: string; children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return <p className="meta">Loading…</p>;
  if (!me) {
    return (
      <>
        <h1 className="page-title">GADMO staff</h1>
        <p className="lede">Sign in with a staff account.</p>
        <Link className="button" href={`/staff?next=${encodeURIComponent(next)}`}>
          Sign in
        </Link>
      </>
    );
  }
  if (me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') {
    return (
      <>
        <h1 className="page-title">GADMO staff</h1>
        <p className="lede">This page is for GADMO staff only.</p>
      </>
    );
  }
  return <>{children}</>;
}
