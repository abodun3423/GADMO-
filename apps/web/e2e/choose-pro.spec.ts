import { expect, test } from '@playwright/test';
import { approvePro, signIn, watchCsp } from './helpers';

const letters = () =>
  Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join(
    '',
  );

test('a customer books for later, chooses a Pro, and they can chat once the Pro accepts', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);

  // A verified painter in Ado-Ekiti, offline (booking requests still reach them).
  const proPage = await browser.newPage();
  await proPage.goto('/signin?next=/account');
  const pro = await signIn(proPage, 'pro');
  const name = `Sade ${letters()}`;
  await proPage.getByLabel('Your name').fill(name);
  await proPage.getByRole('button', { name: 'Save' }).click();
  await expect(proPage.getByRole('status')).toHaveText('Saved.');
  await proPage.goto('/pro/profile');
  await proPage.getByLabel('Search skills').fill('painter');
  await proPage
    .getByRole('checkbox', { name: /^Painter/ })
    .first()
    .check();
  await proPage.getByLabel(/About you/).fill('Interior painting, 6 years');
  await proPage.getByRole('radio', { name: /Ado-Ekiti/ }).check();
  await proPage.getByRole('button', { name: 'Save profile' }).click();
  await expect(proPage.getByRole('status')).toContainText('Profile saved.');
  await approvePro(pro.e164);

  // The customer books a painter for tomorrow.
  await page.goto('/request?service=painter');
  await page.getByRole('link', { name: 'Sign in to continue' }).click();
  await signIn(page, 'customer');
  // Painting isn't an emergency service, so the form only asks for a date and time.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const local = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T14:00`;
  await page.getByLabel('Date and time', { exact: true }).fill(local);
  await page.getByLabel(/What do you need done/).fill('Paint the living room, two coats');
  await page.getByRole('radio', { name: /Somewhere in Ado-Ekiti/ }).check();
  await page.getByRole('button', { name: 'Send request' }).click();

  await expect(page.getByRole('heading', { name: 'Choose a Pro' })).toBeVisible();
  const card = page.locator('.pro-card', { hasText: name });
  await expect(card).toContainText('Verified');
  await expect(card).toContainText('Interior painting, 6 years');
  await expect(card).toContainText('New on GADMO');
  await card.getByRole('button', { name: `Send request to ${name}` }).click();
  await expect(page.getByRole('heading', { name: `Sent to ${name}` })).toBeVisible();
  await page.getByRole('link', { name: 'Go to My jobs' }).click();
  await expect(page.locator('article.job').first()).toContainText(`Waiting for ${name} to answer`);

  // The Pro sees the booking request on Pro home without going online, and accepts.
  await proPage.goto('/pro');
  const request = proPage.getByRole('region', { name: 'Booking request for you' });
  await expect(request).toContainText('Paint the living room, two coats');
  await expect(request.getByRole('timer')).toHaveText(/^Answer within (2[0-4]|1\d) h$/);
  await request.getByRole('button', { name: 'Accept' }).click();
  await expect(proPage.getByRole('status')).toHaveText('Job accepted. It’s in Your jobs below.');

  // Chat is open for both.
  await page.reload();
  await expect(page.locator('article.job').first()).toContainText(`${name} accepted`);
  await page.getByRole('link', { name: 'Open chat' }).first().click();
  await expect(page.getByText(`Your Pro: ${name}`)).toBeVisible();
  await proPage.close();
  noCspViolations();
});
