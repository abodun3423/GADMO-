import type { Metadata } from 'next';
import { DisputeList } from '@/components/admin/DisputeList';

export const metadata: Metadata = { title: 'Poor-work reports', robots: { index: false } };

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const { status, done } = await searchParams;
  return (
    <main className="page page-wide">
      <DisputeList status={status} done={done} />
    </main>
  );
}
