import { expect, test } from '@playwright/test';
import { signIn, watchCsp } from './helpers';

test('a new customer adds their name; only they see their phone number', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/jobs');
  const phone = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');

  // No name yet: My jobs suggests adding one.
  await page.getByRole('link', { name: 'Add your name' }).click();
  await expect(page).toHaveURL('/account/profile');
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expect(
    page.getByText(phone.local.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')),
  ).toBeVisible();
  await expect(page.getByText('Only you can see it', { exact: false })).toBeVisible();

  // Contact details can't be hidden in a name.
  await page.getByLabel(/Full name/).fill('Call me 08031234567');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('letters only');

  await page.getByLabel(/Full name/).fill('  Bola   Ade ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');

  await page.reload();
  await expect(page.getByLabel(/Full name/)).toHaveValue('Bola Ade');
  await page
    .getByRole('navigation', { name: 'Your GADMO' })
    .getByRole('link', { name: 'My jobs' })
    .click();
  await expect(page.getByRole('link', { name: 'Add your name' })).toHaveCount(0);
  noCspViolations();
});

test('a Pro’s account: dashboard with earnings, set-up steps and the account menu', async ({
  page,
}) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/account');
  await signIn(page, 'pro');
  await expect(page).toHaveURL('/account');
  await expect(
    page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
  await expect(page.getByText('Available balance')).toBeVisible();
  await expect(page.getByText('₦0').first()).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add your skills and where you work' }),
  ).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Your account' });
  for (const item of [
    'Dashboard',
    'Jobs & requests',
    'Skills & area',
    'Verification',
    'Settings',
    'Privacy & security',
    'Help',
  ]) {
    await expect(menu.getByRole('link', { name: item })).toBeVisible();
  }
  await menu.getByRole('link', { name: 'Help' }).click();
  await expect(page.getByText('How do I get paid the inspection fee?')).toBeVisible();
  noCspViolations();
});

test('a customer can download their data, ask for deletion and change their mind', async ({
  page,
}) => {
  await page.goto('/signin?next=/account');
  await signIn(page, 'customer');
  await expect(page).toHaveURL('/account');
  await expect(page.getByText('Open requests')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Your account' })
    .getByRole('link', { name: 'Privacy & security' })
    .click();
  await expect(page.getByText('Never your phone number or email', { exact: false })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toBe('gadmo-my-data.json');

  await page.getByRole('button', { name: 'Delete my account…' }).click();
  await page.getByLabel(/Why are you leaving/).fill('Just testing');
  await page.getByRole('button', { name: 'Ask GADMO to delete my account' }).click();
  await expect(page.getByRole('status')).toContainText('You asked us to delete your account');
  await page.getByRole('button', { name: 'Keep my account' }).click();
  await expect(page.getByRole('button', { name: 'Delete my account…' })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Your account' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await page.getByRole('button', { name: 'Sign out everywhere' }).click();
  await expect(page).toHaveURL('/');
  await page.goto('/account');
  await expect(page.getByRole('link', { name: 'Sign in' }).last()).toBeVisible();
});
