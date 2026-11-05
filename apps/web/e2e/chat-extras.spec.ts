import { expect, test } from '@playwright/test';
import { acceptedJob, signIn, watchCsp } from './helpers';

const PNG = {
  name: 'tap.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};

test.use({
  permissions: ['geolocation'],
  geolocation: { latitude: 7.6233, longitude: 5.2209 },
});

/** Test browsers have no microphone: a stand-in recorder that "records" a tiny WebM file. */
const fakeMicrophone = () => {
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  class FakeRecorder {
    mimeType = 'audio/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    static isTypeSupported = (t: string) => t.startsWith('audio/webm');
    start() {}
    stop() {
      const bytes = new Uint8Array(64);
      bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
      this.ondataavailable?.({ data: new Blob([bytes], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
};

test('photos, voice notes and location pins in the job chat', async ({ page, browser }) => {
  const noCspViolations = watchCsp(page);
  await page.addInitScript(fakeMicrophone);
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');

  const proContext = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 7.64, longitude: 5.23 },
  });
  const proPage = await proContext.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/pro');
  const id = await acceptedJob('plumber', customer.e164, pro.e164, 'Toilet keeps running');

  await page.goto(`/jobs/${id}`);
  await proPage.goto(`/jobs/${id}`);

  // The Pro sends a photo; the customer sees it.
  await proPage.locator('#chat-photo').setInputFiles(PNG);
  await expect(proPage.getByRole('img', { name: 'Your photo' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Photo', exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // The customer records a voice note.
  await page.getByRole('button', { name: '🎤 Voice note' }).click();
  await expect(page.getByText(/Recording 0:0/)).toBeVisible();
  await page.getByRole('button', { name: 'Send voice note' }).click();
  await expect(page.getByLabel('Your voice note')).toBeVisible();
  await expect(proPage.getByLabel('Voice note', { exact: true })).toBeVisible({ timeout: 10_000 });

  // The customer's exact location waits for the inspection fee; the Pro can share theirs.
  await page.getByRole('button', { name: '📍 Location' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('once the inspection fee is paid');
  await proPage.getByRole('button', { name: '📍 Location' }).click();
  await expect(proPage.getByText('You shared a location.')).toBeVisible();
  const link = page.getByRole('link', { name: 'Open in Maps' });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await expect(link).toHaveAttribute('href', /query=7\.640000,5\.230000/);
  await proContext.close();
  noCspViolations();
});

test('messages stay in time order, even when both people write at once', async ({
  page,
  browser,
}) => {
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');
  const proContext = await browser.newContext();
  const proPage = await proContext.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/pro');
  const id = await acceptedJob('plumber', customer.e164, pro.e164, 'Kitchen sink is blocked');
  await page.goto(`/jobs/${id}`);
  await proPage.goto(`/jobs/${id}`);
  await expect(page.getByText('Say hello and tell your Pro')).toBeVisible();

  // The Pro writes; the customer writes before their chat has checked for new messages.
  await proPage.getByLabel('Message', { exact: true }).fill('First, from the Pro');
  await proPage.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(proPage.getByText('First, from the Pro')).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill('Then, from the customer');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const bubbles = page.locator('.bubble .bubble-text');
  await expect(bubbles).toHaveText(['First, from the Pro', 'Then, from the customer'], {
    timeout: 10_000,
  });
  await expect(page.locator('.chat-day').first()).toHaveText('Today');
  await expect(page.locator('.bubble-meta').first()).toHaveText(/\d{1,2}:\d{2}\s?(am|pm)/i);
  await proContext.close();
});
