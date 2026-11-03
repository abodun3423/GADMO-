/**
 * Creates a GADMO staff (ADMIN) account, or gives an existing staff member a new
 * password. Staff can't be created in the app; this needs access to the server and database.
 *
 *   pnpm admin:grant 0803 123 4567 ada@gadmo.ng
 *
 * Staff sign in at /staff with the email and the one-time password printed here, plus a
 * code sent to the phone, and should change the password from My account. A Pro account is
 * never converted (it would lose its Pro profile). Every use is written to the audit log.
 */
import { normalizeNigerianPhone } from '@gadmo/shared';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashPassword } from '../src/auth/password';
import { loadEnv } from '../src/config/env';
import { loadDotEnv } from '../src/config/load-dotenv';
import { auditLogs, users } from '../src/db/schema';

function usage(): never {
  console.error('Usage: pnpm admin:grant <phone number> <email>, e.g. 0803 123 4567 ada@gadmo.ng');
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  const args = process.argv.slice(2);
  const email = args
    .find((a) => a.includes('@'))
    ?.trim()
    .toLowerCase();
  const phone = normalizeNigerianPhone(args.filter((a) => !a.includes('@')).join(''));
  if (!phone || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage();

  const password = randomBytes(12).toString('base64url');
  const passwordHash = await hashPassword(password);

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
    const [emailOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (emailOwner && emailOwner.id !== user?.id) {
      console.error('That email already belongs to another staff account.');
      process.exit(1);
    }

    const id = await db.transaction(async (tx) => {
      const values = { role: 'ADMIN' as const, email, passwordHash };
      const [row] = user
        ? await tx
            .update(users)
            .set(values)
            .where(eq(users.id, user.id))
            .returning({ id: users.id })
        : await tx
            .insert(users)
            .values({ phone, ...values })
            .returning({ id: users.id });
      await tx.insert(auditLogs).values({
        action: user && user.role !== 'CUSTOMER' ? 'STAFF_PASSWORD_RESET' : 'GRANT_ADMIN',
        target: `user:${row!.id}`,
        metadata: { from: user?.role ?? 'new account' },
      });
      return row!.id;
    });

    console.log(`\nGADMO staff account ready (${id}).`);
    console.log(`  Sign in at:  /staff`);
    console.log(`  Email:       ${email}`);
    console.log(`  Password:    ${password}   (shown once; change it in My account)`);
    console.log(`  Codes go to: ${args.filter((a) => !a.includes('@')).join(' ')}\n`);
  } finally {
    await pool.end();
  }
}

void main();
