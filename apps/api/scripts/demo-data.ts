/**
 * LOCAL DEVELOPMENT ONLY: fills your database with made-up, verified Pros around
 * Ado-Ekiti (names, skills, ratings, online), so demos don't show an empty app.
 *
 *   pnpm demo:data          add or refresh the demo Pros
 *   pnpm demo:data --remove remove them again
 *
 * Demo Pros use the reserved numbers +234 700 000 0001–0099 (no real person has them)
 * and can sign in like anyone else, so you can show the Pro side too (on a pilot
 * deployment, with its DEMO_LOGIN_CODE). Runs in development, or where DEMO_LOGIN_CODE is set.
 */
import { eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { loadDotEnv } from '../src/config/load-dotenv';
import { auditLogs, categories, proCategories, proProfiles, users } from '../src/db/schema';

const PREFIX = '+23470000000'; // + two digits = +234 700 000 00NN
const ADO = { latitude: 7.6233, longitude: 5.2209 };

/** Made-up people. Skills are catalogue slugs. */
const PROS: {
  name: string;
  skills: string[];
  rating: number;
  reviews: number;
  bio: string;
  km: [number, number];
  online: boolean;
}[] = [
  {
    name: 'Tunde Bakare',
    skills: ['electrician', 'generator-repair'],
    rating: 4.9,
    reviews: 47,
    bio: 'House wiring, sockets, inverters and generator faults. 12 years in Ado-Ekiti.',
    km: [1.1, 0.4],
    online: true,
  },
  {
    name: 'Aduke Ogunleye',
    skills: ['hairstylist'],
    rating: 4.9,
    reviews: 63,
    bio: 'Braids, weaves and bridal hair. I come to you.',
    km: [-0.8, 1.6],
    online: true,
  },
  {
    name: 'Kolawole Fashola',
    skills: ['auto-mechanic', 'auto-electrician'],
    rating: 4.8,
    reviews: 38,
    bio: 'Toyota and Honda specialist. Roadside help on the Ado–Ikere road.',
    km: [2.4, -1.2],
    online: true,
  },
  {
    name: 'Chiamaka Eze',
    skills: ['web-developer'],
    rating: 4.8,
    reviews: 21,
    bio: 'Websites and online shops for small businesses.',
    km: [0.3, -2.1],
    online: false,
  },
  {
    name: 'Ibrahim Musa',
    skills: ['plumber'],
    rating: 4.7,
    reviews: 29,
    bio: 'Leaks, burst pipes, water heaters and borehole pumps.',
    km: [-1.9, -0.6],
    online: true,
  },
  {
    name: 'Folake Adeyemi',
    skills: ['baker'],
    rating: 4.9,
    reviews: 55,
    bio: 'Birthday and wedding cakes, small chops for parties.',
    km: [1.7, 2.2],
    online: false,
  },
  {
    name: 'Segun Ojo',
    skills: ['carpenter'],
    rating: 4.6,
    reviews: 17,
    bio: 'Doors, wardrobes, roofing timber and furniture repairs.',
    km: [-2.6, 1.0],
    online: true,
  },
  {
    name: 'Blessing Akande',
    skills: ['house-cleaner'],
    rating: 4.7,
    reviews: 33,
    bio: 'Deep cleaning for homes and offices, move-in and move-out.',
    km: [0.9, -0.9],
    online: true,
  },
];

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  // On your computer, or on a pilot/demo deployment (one with a demo sign-in code).
  if (env.NODE_ENV !== 'development' && !env.DEMO_LOGIN_CODE) {
    console.error(
      'demo:data runs on your own computer, or on a pilot deployment that has DEMO_LOGIN_CODE set.',
    );
    process.exit(1);
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    if (process.argv.includes('--remove')) {
      const gone = await db
        .delete(users)
        .where(like(users.phone, `${PREFIX}%`))
        .returning({ id: users.id });
      console.log(`Removed ${gone.length} demo Pros.`);
      return;
    }
    const cats = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(
        inArray(
          categories.slug,
          PROS.flatMap((p) => p.skills),
        ),
      );
    if (cats.length === 0) {
      console.error('The service catalogue is empty. Run pnpm update:local first.');
      process.exit(1);
    }
    const idOf = new Map(cats.map((c) => [c.slug, c.id]));
    for (const [i, p] of PROS.entries()) {
      const phone = `${PREFIX}${String(i + 1).padStart(2, '0')}`;
      await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ phone, name: p.name, role: 'PRO' })
          .onConflictDoUpdate({ target: users.phone, set: { name: p.name, role: 'PRO' } })
          .returning({ id: users.id });
        const profile = {
          bio: p.bio,
          latitude: ADO.latitude + p.km[0] / 111.2,
          longitude: ADO.longitude + p.km[1] / 110.2,
          serviceRadiusKm: 20,
          isOnline: p.online,
          ratingAvg: p.rating,
          ratingCount: p.reviews,
          verificationStatus: 'APPROVED' as const,
        };
        await tx
          .insert(proProfiles)
          .values({ userId: user!.id, ...profile })
          .onConflictDoUpdate({ target: proProfiles.userId, set: profile });
        await tx.delete(proCategories).where(eq(proCategories.proId, user!.id));
        const skillIds = p.skills.map((s) => idOf.get(s)).filter((x): x is string => !!x);
        if (skillIds.length) {
          await tx
            .insert(proCategories)
            .values(skillIds.map((categoryId) => ({ proId: user!.id, categoryId })));
        }
      });
    }
    await db.insert(auditLogs).values({
      action: 'DEV_DEMO_DATA',
      target: 'demo-pros',
      metadata: { note: 'local development: made-up verified Pros added', count: PROS.length },
    });
    console.log(
      `Added ${PROS.length} demo Pros around Ado-Ekiti (sign in as one with 0700 000 0001 to 00${String(PROS.length).padStart(2, '0')}).`,
    );
    console.log('Remove them with: pnpm demo:data --remove');
  } finally {
    await pool.end();
  }
}

void main();
