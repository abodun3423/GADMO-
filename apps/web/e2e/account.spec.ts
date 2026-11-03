import { expect, test } from '@playwright/test';
import { signIn, watchCsp } from './helpers';

test('a new customer adds their name; only they see their phone number', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/jobs');
  const phone = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');

  // No name yet: My jobs suggests adding one.
  await page.getByRole('link', { name: 'Add your name' }).click();
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  await expect(
    page.getByText(phone.local.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')),
  ).toBeVisible();
  await expect(page.getByText('Only you can see your number')).toBeVisible();

  // Contact details can't be hidden in a name.
  await page.getByLabel('Your name').fill('Call me 08031234567');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('letters only');

  await page.getByLabel('Your name').fill('  Bola   Ade ');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');

  await page.reload();
  await expect(page.getByLabel('Your name')).toHaveValue('Bola Ade');
  await page
    .getByRole('navigation', { name: 'Your GADMO' })
    .getByRole('link', { name: 'My jobs' })
    .click();
  await expect(page.getByRole('link', { name: 'Add your name' })).toHaveCount(0);
  noCspViolations();
});

test('a Pro account is labelled as one', async ({ page }) => {
  await page.goto('/signin?next=/account');
  await signIn(page, 'pro');
  await expect(page).toHaveURL('/account');
  await expect(page.getByText('Pro account: you offer a skill or service')).toBeVisible();
});
