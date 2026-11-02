/** Seeds launch categories. Inspection fees are 0 until the business sets them (PRD open question). */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { categories } from './schema';

export const LAUNCH_CATEGORIES = [
  { name: 'Auto mechanic', slug: 'auto-mechanic', emergencyEnabled: true },
  { name: 'Electrician', slug: 'electrician', emergencyEnabled: true },
  { name: 'Plumber', slug: 'plumber', emergencyEnabled: true },
  { name: 'Locksmith', slug: 'locksmith', emergencyEnabled: true },
  { name: 'Carpenter', slug: 'carpenter', emergencyEnabled: false },
  { name: 'Cleaner', slug: 'cleaner', emergencyEnabled: false },
  { name: 'Painter', slug: 'painter', emergencyEnabled: false },
  { name: 'Baker', slug: 'baker', emergencyEnabled: false },
];

export async function seed(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await drizzle(pool)
      .insert(categories)
      .values(LAUNCH_CATEGORIES)
      .onConflictDoNothing({ target: categories.slug });
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
    .then(() => console.warn('Seeded categories'))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
