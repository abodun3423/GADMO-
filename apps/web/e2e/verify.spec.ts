import { expect, test } from '@playwright/test';
import { createStaff, signIn, staffSignIn, storedVerification, watchCsp } from './helpers';

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

test('GADMO staff ask for a better photo, then approve; the Pro can go online', async ({
  page,
  browser,
}) => {
  // A Pro with a profile sends their identity check.
  await page.goto('/signin');
  const pro = await signIn(page, 'pro');
  await page.goto('/account/profile');
  await page.getByLabel(/Full name/).fill('Kemi Adeyemi');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await page.goto('/pro/profile');
  await page.getByLabel('Search skills').fill('plumber');
  await page.getByRole('checkbox', { name: 'Plumber', exact: true }).check();
  await page.getByRole('radio', { name: /Ado-Ekiti/ }).check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
  const sendCheck = async () => {
    await page.goto('/pro/verify');
    await page.getByLabel('Your NIN').fill('98765432109');
    await page.getByLabel('Photo of your ID').setInputFiles(photo('id.png'));
    await page.getByLabel('A selfie').setInputFiles(photo('me.png'));
    await expect(page.getByText('✓ Added')).toHaveCount(2);
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByRole('heading', { name: 'Under review' })).toBeVisible();
  };
  await sendCheck();

  // A staff member reviews it.
  const staffPage = await browser.newPage();
  await staffSignIn(staffPage, await createStaff());
  await expect(staffPage).toHaveURL('/admin');
  await expect(
    staffPage
      .getByRole('navigation', { name: 'Your GADMO' })
      .getByRole('link', { name: 'Dashboard' }),
  ).toBeVisible();
  await staffPage
    .getByRole('navigation', { name: 'Staff sections' })
    .getByRole('link', { name: 'Identity checks' })
    .click();
  await staffPage
    .getByRole('link', { name: /Kemi Adeyemi/ })
    .first()
    .click();
  await expect(staffPage.getByText('98765432109')).toBeVisible();
  await expect(staffPage.getByRole('img', { name: 'Selfie' })).toBeVisible();
  await expect(staffPage.getByText('Plumber')).toBeVisible();

  await staffPage.getByRole('radio', { name: /Ask for more/ }).check();
  await staffPage.getByRole('button', { name: 'Save decision' }).click();
  await expect(staffPage.locator('p[role="alert"]')).toContainText('Tell the Pro what to fix');
  await staffPage.getByLabel(/Note to the Pro/).fill('The ID photo is blurred. Please retake it.');
  await staffPage.getByRole('button', { name: 'Save decision' }).click();
  await expect(staffPage.getByRole('status')).toHaveText('Sent back to the Pro with your note.');

  // The Pro sees the note, sends again, and is approved.
  await page.goto('/pro/verify');
  await expect(page.getByText('The ID photo is blurred. Please retake it.')).toBeVisible();
  await sendCheck();

  await staffPage.goto('/admin/checks');
  await staffPage
    .getByRole('link', { name: /Kemi Adeyemi/ })
    .first()
    .click();
  await expect(staffPage.getByText('Earlier checks')).toBeVisible();
  await staffPage.getByRole('radio', { name: /Approve/ }).check();
  await staffPage.getByRole('button', { name: 'Save decision' }).click();
  await expect(staffPage.getByRole('status')).toHaveText('Approved. The Pro can now go online.');
  await staffPage.close();

  await page.goto('/pro');
  await expect(page.getByText('Verified. Customers see your verified badge.')).toBeVisible();
  await page.getByRole('button', { name: 'Go online' }).click();
  await expect(page.getByRole('heading', { name: 'You’re online' })).toBeVisible();
  expect(pro.e164).toMatch(/^\+234/);
});
