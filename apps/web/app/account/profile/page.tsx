import type { Metadata } from 'next';
import { ProfilePage } from '@/components/account/ProfilePage';

export const metadata: Metadata = { title: 'Profile' };

export default function Page() {
  return (
    <main className="page page-wide page-app">
      <ProfilePage />
    </main>
  );
}
