import type { Metadata } from 'next';
import { ReviewCheck } from '@/components/admin/ReviewCheck';

export const metadata: Metadata = { title: 'Review identity check', robots: { index: false } };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page page-wide">
      <ReviewCheck id={id} />
    </main>
  );
}
