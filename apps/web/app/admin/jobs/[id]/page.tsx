import type { Metadata } from 'next';
import { JobMatchingView } from '@/components/admin/JobMatching';

export const metadata: Metadata = { title: 'Job', robots: { index: false } };

export default async function AdminJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page page-wide">
      <JobMatchingView id={id} />
    </main>
  );
}
