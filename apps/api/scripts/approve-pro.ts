/**
 * LOCAL DEVELOPMENT ONLY: marks a Pro's identity check as approved, so you can test going
 * online and seeing requests before the real KYC provider and admin review exist.
 *
 *   pnpm pro:approve 0803 123 4567
 *
 * Refuses to run unless NODE_ENV=development. Every use is written to the audit log.
 */
import { normalizeNigerianPhone } from '@gadmo/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { loadDotEnv } from '../src/config/load-dotenv';
import { auditLogs, proProfiles, users } from '../src/db/schema';

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  if (env.NODE_ENV !== 'development') {
    console.error('pro:approve only works on your own computer (NODE_ENV=development).');
    process.exit(1);
  }
  const phone = normalizeNigerianPhone(process.argv.slice(2).join(''));
  if (!phone) {
    console.error('Usage: pnpm pro:approve <Pro phone number>, for example 0803 123 4567');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    if (!user || user.role !== 'PRO') {
      console.error('No Pro account with that number. Sign up as a Pro in the app first.');
      process.exit(1);
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(proProfiles)
        .values({ userId: user.id, verificationStatus: 'APPROVED' })
        .onConflictDoUpdate({
          target: proProfiles.userId,
          set: { verificationStatus: 'APPROVED' },
        });
      await tx.insert(auditLogs).values({
        action: 'DEV_APPROVE_PRO',
        target: `user:${user.id}`,
        metadata: { note: 'local development shortcut; no identity check was done' },
      });
    });
    console.log('Done: this Pro is marked as verified on your computer. They can now go online.');
  } finally {
    await pool.end();
  }
}

void main();
