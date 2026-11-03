import { expect, test } from '@playwright/test';
import { signIn, watchCsp } from './helpers';

test('a new Pro sets up skills, bio and area', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/account');
  await signIn(page, 'pro');
  await page.getByRole('link', { name: /Your Pro profile/ }).click();
  await expect(page).toHaveURL('/pro/profile');
  await expect(page.getByText('No skills chosen yet.')).toBeVisible();

  // Saving needs a skill.
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('at least one skill');

  await page.getByLabel('Search skills').fill('electric');
  await page.getByRole('checkbox', { name: 'Electrician', exact: true }).check();
  await page.getByLabel('Search skills').fill('');
  await page.getByText('Home repairs & installation').click();
  await page.getByRole('checkbox', { name: 'Plumber', exact: true }).check();
  await expect(page.getByText('2 chosen: Electrician, Plumber')).toBeVisible();

  await page.getByLabel(/About you/).fill('Electrician for 8 years. Call 0803 123 4567.');
  await page.getByRole('radio', { name: /Ado-Ekiti/ }).check();
  await page.getByLabel('How far will you travel?').selectOption('20');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
  await expect(page.getByRole('status')).toContainText('identity check');

  await page.reload();
  await expect(page.getByText('2 chosen: Electrician, Plumber')).toBeVisible();
  await expect(page.getByLabel(/About you/)).not.toHaveValue(/0803/);
  await expect(page.getByLabel('How far will you travel?')).toHaveValue('20');
  await expect(page.getByText('Using the place you saved before.')).toBeVisible();
  noCspViolations();
});

test('a customer is told the Pro profile is for Pros', async ({ page }) => {
  await page.goto('/signin?next=/pro/profile');
  await signIn(page, 'customer');
  await expect(page).toHaveURL('/pro/profile');
  await expect(page.getByText('This page is for Pros.')).toBeVisible();
});
