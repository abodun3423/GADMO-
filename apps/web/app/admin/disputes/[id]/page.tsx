import type { Metadata } from 'next';
import { DisputeReview } from '@/components/admin/DisputeReview';

export const metadata: Metadata = { title: 'Report', robots: { index: false } };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page page-wide">
      <DisputeReview id={id} />
    </main>
  );
}
