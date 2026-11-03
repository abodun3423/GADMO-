import type { Metadata } from 'next';
import { ReviewQueue } from '@/components/admin/ReviewQueue';

export const metadata: Metadata = { title: 'Identity checks', robots: { index: false } };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const { status, done } = await searchParams;
  return (
    <main className="page page-wide">
      <ReviewQueue status={status} done={done} />
    </main>
  );
}
