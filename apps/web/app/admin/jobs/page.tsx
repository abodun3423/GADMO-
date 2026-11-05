import type { Metadata } from 'next';
import { JobsList } from '@/components/admin/JobsList';

export const metadata: Metadata = { title: 'Jobs', robots: { index: false } };

export default function JobsPage() {
  return (
    <main className="page page-wide">
      <JobsList />
    </main>
  );
}
