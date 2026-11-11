import type { Metadata } from 'next';
import { SkillCheckVisit } from '@/components/admin/SkillCheckVisit';

export const metadata: Metadata = { title: 'Skill check', robots: { index: false } };

export default async function SkillCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page page-wide">
      <SkillCheckVisit id={id} />
    </main>
  );
}
