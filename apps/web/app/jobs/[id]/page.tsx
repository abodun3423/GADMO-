import type { Metadata } from 'next';
import { JobChat } from '@/components/JobChat';

export const metadata: Metadata = { title: 'Job chat' };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page chat-page">
      <JobChat jobId={id} />
    </main>
  );
}
