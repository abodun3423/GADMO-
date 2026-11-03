import type { Metadata } from 'next';
import { ProProfileForm } from '@/components/ProProfileForm';
import { getCatalogue } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Your Pro profile' };

export default async function ProProfilePage() {
  const groups = await getCatalogue();
  return (
    <main className="page">
      <ProProfileForm groups={groups ?? []} />
    </main>
  );
}
