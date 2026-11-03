import type { Metadata } from 'next';
import { StaffSignIn } from '@/components/admin/StaffSignIn';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Staff sign-in', robots: { index: false } };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="page">
      <StaffSignIn next={safeNext(next, '/admin')} />
    </main>
  );
}
