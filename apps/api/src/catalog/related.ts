import { and, eq, exists, inArray, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { relatedSlugs } from '../db/categories';
import { categories, proCategories } from '../db/schema';
import type { Db } from '../infra/infra.module';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * These categories plus the ones related to them (see RELATED in db/categories.ts).
 * A request for any of the returned ids can go to a Pro with one of the given skills,
 * and the other way round, because related sets work both ways.
 */
export async function withRelated(db: Db | Tx, categoryIds: string[]): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  const own = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(inArray(categories.id, categoryIds));
  const related = relatedSlugs(own.map((c) => c.slug));
  const extra = related.length
    ? await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(inArray(categories.slug, related), eq(categories.active, true)))
    : [];
  return [...new Set([...categoryIds, ...extra.map((c) => c.id)])];
}

/** True when the Pro (by user id column) has at least one of these skills. */
export function offersAnyOf(db: Db | Tx, proId: AnyPgColumn, categoryIds: string[]): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(proCategories)
      .where(and(eq(proCategories.proId, proId), inArray(proCategories.categoryId, categoryIds))),
  );
}
