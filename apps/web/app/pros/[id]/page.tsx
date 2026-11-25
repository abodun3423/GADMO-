import type { Metadata } from 'next';
import { ProProfileView } from '@/components/ProProfileView';

export const metadata: Metadata = { title: 'Pro profile' };

export default async function ProProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  // Only a path inside GADMO, never another website.
  const safeBack = back && back.startsWith('/') && !back.startsWith('//') ? back : null;
  return (
    <main className="page">
      <ProProfileView proId={id} back={safeBack} />
    </main>
  );
}
