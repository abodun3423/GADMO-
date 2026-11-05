import type { Metadata } from 'next';
import { AdminOverview } from '@/components/admin/AdminOverview';

export const metadata: Metadata = { title: 'Staff dashboard', robots: { index: false } };

export default function AdminPage() {
  return (
    <main className="page page-wide">
      <AdminOverview />
    </main>
  );
}
