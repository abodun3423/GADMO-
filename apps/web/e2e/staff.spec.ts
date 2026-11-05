import { expect, test } from '@playwright/test';
import { createStaff, readCode, signIn, staffSignIn, watchCsp } from './helpers';

test('staff sign in on their own page, not the customer one', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  const staff = await createStaff();

  // The customer and Pro sign-in refuses a staff number.
  await page.goto('/signin');
  await page.getByLabel('Phone number').fill(`0${staff.e164.slice(4)}`);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await page.getByLabel('6-digit code').fill(await readCode(staff.e164));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('staff page');

  // A wrong password gets a plain message.
  await page.goto('/staff');
  await page.getByLabel('Work email').fill(staff.email);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Email or password is wrong.');

  // Password, then the phone code: straight to the review queue.
  await staffSignIn(page, staff);
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'GADMO in numbers' })).toContainText('Customers');

  // Staff change the password they were given.
  await page.goto('/account');
  await expect(page.getByText('GADMO staff account.')).toBeVisible();
  await page.getByLabel('Current password').fill(staff.password);
  await page.getByLabel(/New password/).fill('short');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toHaveText('Use at least 12 characters.');
  await page.getByLabel(/New password/).fill('green plantain market morning');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('status')).toHaveText('Password changed.');
  noCspViolations();
});

test('the review queue sends signed-out visitors to the staff sign-in', async ({ page }) => {
  await page.goto('/admin');
  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/staff?next=%2Fadmin');
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
});

test('a Pro who opens the staff pages can switch to the staff sign-in', async ({ page }) => {
  await page.goto('/signin');
  await signIn(page, 'pro');
  await expect(page).toHaveURL('/pro');
  await page.goto('/admin');
  await expect(page.getByText('You’re signed in with your Pro account.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out and go to staff sign-in' }).click();
  await expect(page).toHaveURL('/staff?next=%2Fadmin');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
});
