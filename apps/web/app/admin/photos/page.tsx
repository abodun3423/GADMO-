import type { Metadata } from 'next';
import { WorkPhotoList } from '@/components/admin/WorkPhotoList';

export const metadata: Metadata = { title: 'Work photos', robots: { index: false } };

export default function WorkPhotosPage() {
  return (
    <main className="page page-wide">
      <WorkPhotoList />
    </main>
  );
}
