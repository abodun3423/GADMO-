import type { Metadata } from 'next';
import { SettingsPage } from '@/components/account/SettingsPage';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <main className="page page-wide page-app">
      <SettingsPage />
    </main>
  );
}
