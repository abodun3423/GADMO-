import { expect, test } from '@playwright/test';
import { clearCode, randomPhone, readCode, signIn, watchCsp } from './helpers';

test('a new customer signs in, books a plumber for later, and sees it in My jobs', async ({
  page,
}) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/request?service=plumber');
  await expect(page.getByRole('heading', { name: 'Plumber' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in to continue' }).click();

  await expect(page).toHaveURL(/\/signin\?next=/);
  await signIn(page, 'customer');

  // Back on the request form, signed in.
  await expect(page).toHaveURL(/\/request\?service=plumber/);
  await expect(page.getByRole('link', { name: 'My jobs' })).toBeVisible();

  await page.getByRole('radio', { name: /Pick a date and time/ }).check();
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  tomorrow.setHours(10, 0, 0, 0);
  const local = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T10:00`;
  await page.getByLabel('Date and time', { exact: true }).fill(local);
  await page
    .getByLabel(/What do you need done/)
    .fill('Kitchen tap leaking. Call me on 0803 555 1234 when you get here');
  await page.getByRole('radio', { name: /Somewhere in Ado-Ekiti/ }).check();
  await page.getByRole('button', { name: 'Send request' }).click();

  // Booked for later: the customer chooses a Pro next.
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]+\/choose$/);
  await expect(page.getByRole('heading', { name: 'Choose a Pro' })).toBeVisible();
  await page.getByRole('link', { name: '← My jobs' }).click();
  const job = page.locator('article.job').first();
  await expect(job.getByRole('heading', { name: 'Plumber' })).toBeVisible();
  await expect(job).toContainText('Choose a Pro for this job.');
  await expect(job.getByRole('link', { name: 'Choose a Pro' })).toBeVisible();
  // The phone number typed into the description was hidden by GADMO.
  await expect(job).toContainText('[hidden by GADMO]');
  await expect(job).not.toContainText('555 1234');

  noCspViolations();
});

test('an emergency request uses the phone’s location', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 7.6301, longitude: 5.2214 });

  await page.goto('/');
  await page
    .getByRole('region', { name: /Stuck\? Get help now/ })
    .getByRole('link', { name: 'Electrician', exact: true })
    .click();
  await page.getByRole('link', { name: 'Sign in to continue' }).click();
  await signIn(page, 'customer');

  await expect(page.getByRole('radio', { name: /Right now/ })).toBeChecked();
  await page.getByLabel(/What do you need done/).fill('Sparks from the socket in the shop');
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByRole('button', { name: /Using your current location/ })).toBeVisible();
  await page.getByRole('button', { name: 'Get help now' }).click();

  await expect(page).toHaveURL(/\/jobs/);
  await expect(page.locator('article.job').first()).toContainText('Emergency, requested');
});

test('the form explains what is missing instead of sending', async ({ page }) => {
  await page.goto('/request?service=carpenter');
  await page.getByRole('link', { name: 'Sign in to continue' }).click();
  await signIn(page, 'customer');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Describe the job');
});

test('a Pro is told customer booking is not available from a Pro account', async ({ page }) => {
  await page.goto('/signin');
  await signIn(page, 'pro');
  await expect(page).toHaveURL('/pro');
  await page.goto('/request?service=painter');
  await expect(page.getByText(/You’re signed in as a Pro/)).toBeVisible();
  await page.goto('/jobs');
  await expect(page.getByText(/Signed in as .* \(Pro\)/)).toBeVisible();
});

test('a wrong phone number or code gets a clear message', async ({ page }) => {
  await page.goto('/signin');
  await page.getByLabel('Phone number').fill('12345');
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Enter a Nigerian mobile number');

  const phone = randomPhone();
  await page.getByLabel('Phone number').fill(phone.local);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  const real = await readCode(phone.e164);
  await page.getByLabel('6-digit code').fill(real === '000000' ? '111111' : '000000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('wrong or has expired');
});

test('a new code can be sent, and the newest code signs in', async ({ page }) => {
  await page.goto('/signin?next=/jobs');
  const phone = randomPhone();
  await page.getByLabel('Phone number').fill(phone.local);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  const first = await readCode(phone.e164);
  await clearCode(phone.e164);

  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByText(`We sent a new code to ${phone.local}`)).toBeVisible();
  const newest = await readCode(phone.e164);
  if (first !== newest) {
    await page.getByLabel('6-digit code').fill(first);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText('wrong or has expired');
  }
  await page.getByLabel('6-digit code').fill(newest);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL('/jobs');
});

test('signing out ends the session', async ({ page }) => {
  await page.goto('/signin?next=/jobs');
  await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.goto('/jobs');
  await expect(page.getByText('Sign in to see the jobs')).toBeVisible();
});

test('sign-in never redirects to another website', async ({ page }) => {
  await page.goto('/signin?next=//evil.example.com');
  await signIn(page, 'customer');
  await expect(page).toHaveURL('/');
});
