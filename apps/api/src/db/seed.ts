/**
 * Seeds (or updates) the service catalogue from ./categories.ts. Safe to run repeatedly:
 * existing rows are matched by slug and updated, so names and flags can be changed later.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CATALOGUE, INSPECTION_POLICY } from './categories';
import { categories } from './schema';

const upsertSet = {
  name: sql`excluded.name`,
  parentId: sql`excluded.parent_id`,
  emergencyEnabled: sql`excluded.emergency_enabled`,
  inspectionPolicy: sql`excluded.inspection_policy`,
  licenceRequired: sql`excluded.licence_required`,
  sortOrder: sql`excluded.sort_order`,
};

export async function seed(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      for (const [groupIndex, group] of CATALOGUE.entries()) {
        const [groupRow] = await tx
          .insert(categories)
          .values({ slug: group.slug, name: group.name, sortOrder: groupIndex })
          .onConflictDoUpdate({ target: categories.slug, set: upsertSet })
          .returning({ id: categories.id });

        await tx
          .insert(categories)
          .values(
            group.categories.map((cat, index) => ({
              slug: cat.slug,
              name: cat.name,
              parentId: groupRow!.id,
              emergencyEnabled: cat.emergency ?? false,
              inspectionPolicy: INSPECTION_POLICY[cat.inspection],
              licenceRequired: cat.licence ?? false,
              sortOrder: index,
            })),
          )
          .onConflictDoUpdate({ target: categories.slug, set: upsertSet });
      }
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  seed(url)
    .then(() => console.warn('Seeded service catalogue'))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
