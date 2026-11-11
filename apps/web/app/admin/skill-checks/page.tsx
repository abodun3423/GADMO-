import type { Metadata } from 'next';
import { SkillCheckList } from '@/components/admin/SkillCheckList';

export const metadata: Metadata = { title: 'Skill checks', robots: { index: false } };

export default async function SkillChecksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; done?: string }>;
}) {
  const { status, done } = await searchParams;
  return (
    <main className="page page-wide">
      <SkillCheckList status={status} done={done} />
    </main>
  );
}
