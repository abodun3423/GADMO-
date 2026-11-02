import { expect, type Page } from '@playwright/test';
import Redis from 'ioredis';

const redis = new Redis(process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14', {
  lazyConnect: true,
});

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
