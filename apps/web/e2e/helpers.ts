import { expect, type Page } from '@playwright/test';
import Redis from 'ioredis';
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

/** Creates an open request near Ado-Ekiti directly in the e2e database. */
export async function insertJob(
  categorySlug: string,
  customerE164: string,
  description: string,
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (customer_id, category_id, type, description, latitude, longitude)
     SELECT u.id, c.id, 'EMERGENCY', $3, 7.63, 5.221
     FROM users u, categories c WHERE u.phone = $2 AND c.slug = $1`,
    [categorySlug, customerE164, description],
  );
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

/** Makes this account GADMO staff (what `pnpm admin:grant` does on a server). */
export async function makeStaff(e164: string): Promise<void> {
  const res = await db.query(`UPDATE users SET role = 'ADMIN' WHERE phone = $1`, [e164]);
  if (res.rowCount !== 1) throw new Error(`No account for ${e164}`);
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
  return phone;
}
