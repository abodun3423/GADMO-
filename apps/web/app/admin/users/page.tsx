import type { Metadata } from 'next';
import { UsersList } from '@/components/admin/UsersList';

export const metadata: Metadata = { title: 'Users', robots: { index: false } };

export default function UsersPage() {
  return (
    <main className="page page-wide">
      <UsersList />
    </main>
  );
}
