import type { Metadata } from 'next';
import { ChoosePro } from '@/components/ChoosePro';

export const metadata: Metadata = { title: 'Choose a Pro' };

export default async function ChooseProPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page">
      <ChoosePro jobId={id} />
    </main>
  );
}
