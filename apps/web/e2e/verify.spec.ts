import { expect, test } from '@playwright/test';
import { signIn, storedVerification, watchCsp } from './helpers';

/** A tiny valid PNG (the app re-encodes it as JPEG before upload). */
const photo = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
});

test('a Pro sends their NIN, ID photo and selfie for review', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin');
  const pro = await signIn(page, 'pro');
  await expect(page).toHaveURL('/pro');
  await page.getByRole('link', { name: 'Verify your identity' }).click();
  await expect(page).toHaveURL('/pro/verify');

  await page.getByLabel('Your NIN').fill('1234567890');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Your NIN has 11 digits.');

  await page.getByLabel('Your NIN').fill('1234 5678 901');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Add a photo of your ID');

  await page.getByLabel('Photo of your ID').setInputFiles(photo('id.png'));
  await page.getByLabel('A selfie').setInputFiles(photo('me.png'));
  await expect(page.getByText('✓ Added')).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Your a selfie' })).toBeVisible();

  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('heading', { name: 'Under review' })).toBeVisible();

  const stored = await storedVerification(pro.e164);
  expect(stored).toMatchObject({ result: 'PENDING', files: 2 });
  expect(stored!.ninEncrypted).not.toContain('12345678901');

  await page.getByRole('link', { name: 'Go to Pro home' }).click();
  await expect(page.getByText('Under review by GADMO')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go online' })).toBeDisabled();
  noCspViolations();
});
