/**
 * Makes a phone number a GADMO staff (ADMIN) account, so it can open the review pages.
 * Admins can't be created through the app; this needs access to the server and database.
 *
 *   pnpm admin:grant 0803 123 4567
 *
 * The number then signs in like anyone else. A Pro account is never converted (it would
 * lose its Pro profile); use a separate number for staff. Written to the audit log.
 */
import { normalizeNigerianPhone } from '@gadmo/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadEnv } from '../src/config/env';
import { loadDotEnv } from '../src/config/load-dotenv';
import { auditLogs, users } from '../src/db/schema';

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const phone = normalizeNigerianPhone(process.argv.slice(2).join(''));
  if (!phone) {
    console.error('Usage: pnpm admin:grant <phone number>, for example 0803 123 4567');
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
    if (user?.role === 'PRO') {
      console.error('That number is a Pro account. Use a different number for GADMO staff.');
      process.exit(1);
    }
    if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') {
      console.log('That number is already a staff account.');
      return;
    }
    const id = await db.transaction(async (tx) => {
      const [row] = user
        ? await tx
            .update(users)
            .set({ role: 'ADMIN' })
            .where(eq(users.id, user.id))
            .returning({ id: users.id })
        : await tx.insert(users).values({ phone, role: 'ADMIN' }).returning({ id: users.id });
      await tx.insert(auditLogs).values({
        action: 'GRANT_ADMIN',
        target: `user:${row!.id}`,
        metadata: { from: user?.role ?? 'new account' },
      });
      return row!.id;
    });
    console.log(
      `Done: ${user ? 'this customer account is now' : 'created'} a GADMO staff account (${id}). Sign in with it and open /admin.`,
    );
  } finally {
    await pool.end();
  }
}

void main();
