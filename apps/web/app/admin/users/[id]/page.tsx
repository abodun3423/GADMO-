import type { Metadata } from 'next';
import { UserDetail } from '@/components/admin/UserDetail';

export const metadata: Metadata = { title: 'User', robots: { index: false } };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page page-wide">
      <UserDetail id={id} />
    </main>
  );
}
