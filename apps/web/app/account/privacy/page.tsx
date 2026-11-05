import type { Metadata } from 'next';
import { PrivacyPage } from '@/components/account/PrivacyPage';

export const metadata: Metadata = { title: 'Privacy & security' };

export default function Page() {
  return (
    <main className="page page-wide page-app">
      <PrivacyPage />
    </main>
  );
}
