import { expect, type Page } from '@playwright/test';
import Redis from 'ioredis';
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const redis = new Redis(process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14', {
  lazyConnect: true,
});

const db = new pg.Pool({
  connectionString:
    process.env.E2E_DATABASE_URL ?? 'postgresql://gadmo:gadmo_local_only@localhost:5432/gadmo_e2e',
  max: 1,
});

/** Stands in for GADMO staff approving the identity check: marks this Pro as verified in the e2e database. */
export async function approvePro(e164: string): Promise<void> {
  const res = await db.query(
    `UPDATE pro_profiles SET verification_status = 'APPROVED'
     WHERE user_id = (SELECT id FROM users WHERE phone = $1)`,
    [e164],
  );
  if (res.rowCount !== 1) throw new Error(`No Pro profile for ${e164}`);
}

/** Puts money in a Pro's wallet, as an arrival code would (balanced ledger entries). */
export async function creditProWallet(e164: string, kobo: number): Promise<void> {
  await db.query(
    `WITH u AS (SELECT id FROM users WHERE phone = $1), t AS (SELECT gen_random_uuid() AS id)
     INSERT INTO ledger_entries (txn_id, account, debit_kobo, credit_kobo, description)
     SELECT t.id, 'test:source', $2, 0, 'test' FROM t
     UNION ALL
     SELECT t.id, 'pro:' || u.id, 0, $2, 'Inspection fee for arriving' FROM t, u`,
    [e164, kobo],
  );
}

/** How many browsers get alerts for this account. */
export async function pushSubscriptionsOf(e164: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM push_subscriptions s JOIN users u ON u.id = s.user_id
     WHERE u.phone = $1`,
    [e164],
  );
  return (res.rows[0] as { n: number }).n;
}

/** Creates an open request near Ado-Ekiti directly in the e2e database. */
export async function insertJob(
  categorySlug: string,
  customerE164: string,
  description: string,
  type: 'EMERGENCY' | 'SCHEDULED' = 'EMERGENCY',
): Promise<string> {
  const res = await db.query(
    `INSERT INTO jobs (customer_id, category_id, type, description, latitude, longitude, scheduled_at)
     SELECT u.id, c.id, $4::job_type, $3, 7.63, 5.221,
            CASE WHEN $4::job_type = 'SCHEDULED' THEN now() + interval '2 days' END
     FROM users u, categories c WHERE u.phone = $2 AND c.slug = $1
     RETURNING id`,
    [categorySlug, customerE164, description, type],
  );
  return (res.rows[0] as { id: string }).id;
}

/** What the e2e database holds for a Pro's identity check (to prove the NIN is not stored in clear). */
export async function storedVerification(
  e164: string,
): Promise<{ result: string; ninEncrypted: string; files: number } | null> {
  const res = await db.query(
    `SELECT v.result, v.nin_encrypted,
            (SELECT count(*)::int FROM private_files f WHERE f.verification_id = v.id) AS files
     FROM verifications v JOIN users u ON u.id = v.pro_id WHERE u.phone = $1`,
    [e164],
  );
  const row = res.rows[0] as { result: string; nin_encrypted: string; files: number } | undefined;
  return row ? { result: row.result, ninEncrypted: row.nin_encrypted, files: row.files } : null;
}

/**
 * Creates a GADMO staff account (what `pnpm admin:grant` does on a server), with the same
 * password format as apps/api/src/auth/password.ts.
 */
export async function createStaff(): Promise<{ e164: string; email: string; password: string }> {
  const { e164 } = randomPhone();
  const email = `staff-${e164.slice(4)}@gadmo.test`;
  const password = 'a long staff password for tests';
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const hash = [
    'scrypt',
    2 ** 15,
    8,
    1,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
  await db.query(
    `INSERT INTO users (phone, role, email, password_hash) VALUES ($1, 'ADMIN', $2, $3)`,
    [e164, email, hash],
  );
  return { e164, email, password };
}

/** Signs in through the staff page: email + password, then the phone code. */
export async function staffSignIn(
  page: Page,
  staff: { e164: string; email: string; password: string },
): Promise<void> {
  await page.goto('/staff');
  await page.getByLabel('Work email').fill(staff.email);
  await page.getByLabel('Password').fill(staff.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('We sent a code to your phone')).toBeVisible();
  await page.getByLabel('6-digit code').fill(await readCode(staff.e164));
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A job a Pro has already accepted (skips dispatch), returning its id. */
export async function acceptedJob(
  categorySlug: string,
  customerE164: string,
  proE164: string,
  description: string,
): Promise<string> {
  const res = await db.query(
    `INSERT INTO jobs (customer_id, pro_id, status, category_id, type, description, latitude, longitude)
     SELECT cu.id, pr.id, 'ACCEPTED', c.id, 'SCHEDULED', $4, 7.63, 5.221
     FROM users cu, users pr, categories c
     WHERE cu.phone = $2 AND pr.phone = $3 AND c.slug = $1
     RETURNING id`,
    [categorySlug, customerE164, proE164, description],
  );
  return (res.rows[0] as { id: string }).id;
}

export function randomPhone(): { local: string; e164: string } {
  const rest = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return { local: `0803${rest}`, e164: `+234803${rest}` };
}

/** Reads the login code the API's test "outbox" SMS provider stored for this phone. */
export async function readCode(e164: string): Promise<string> {
  if (redis.status === 'wait') await redis.connect();
  for (let i = 0; i < 50; i++) {
    const text = await redis.get(`test:sms-outbox:${e164}`);
    const code = text && /\b(\d{6})\b/.exec(text)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No login code for ${e164}`);
}

/** Forgets the last stored code, so the next readCode waits for a newly sent one. */
export async function clearCode(e164: string): Promise<void> {
  if (redis.status === 'wait') await redis.connect();
  await redis.del(`test:sms-outbox:${e164}`);
}

/** Fails the test if the browser blocks anything under the Content Security Policy. */
export function watchCsp(page: Page): () => void {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  return () => expect(violations, 'CSP violations').toEqual([]);
}

/** Signs in through the real phone + code screens. */
export async function signIn(
  page: Page,
  as: 'customer' | 'pro' = 'customer',
): Promise<{ local: string; e164: string }> {
  const phone = randomPhone();
  await page.getByLabel('Phone number').fill(phone.local);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByText(`We sent a code to ${phone.local}`)).toBeVisible();
  await page.getByLabel('6-digit code').fill(await readCode(phone.e164));
  await page.getByRole('radio', { name: as === 'pro' ? /I offer a skill/ : /I need help/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Wait until the session exists, so the next navigation can't cut sign-in short.
  await expect(page).not.toHaveURL(/\/signin/);
  return phone;
}

/** Stands in for a whole job: assigns it to the Pro, adds a chat message from the customer, and marks it completed. */
export async function finishJob(
  jobId: string,
  proE164: string,
  customerMessage: string,
): Promise<void> {
  await db.query(
    `UPDATE jobs SET pro_id = (SELECT id FROM users WHERE phone = $2), status = 'COMPLETED'
     WHERE id = $1`,
    [jobId, proE164],
  );
  await db.query(
    `INSERT INTO messages (job_id, sender_id, body)
     SELECT j.id, j.customer_id, $2 FROM jobs j WHERE j.id = $1`,
    [jobId, customerMessage],
  );
}
