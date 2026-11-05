import { expect, test } from '@playwright/test';
import { createStaff, signIn, staffSignIn, watchCsp } from './helpers';

test('staff find a Pro, suspend them (they are signed out), then reactivate', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  const proPage = await browser.newPage();
  await proPage.goto('/signin?next=/account');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/account');
  const name = `Femi ${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
  await proPage.getByLabel('Your name').fill(name);
  await proPage.getByRole('button', { name: 'Save' }).click();
  await expect(proPage.getByRole('status')).toHaveText('Saved.');

  await staffSignIn(page, await createStaff());
  await expect(page).toHaveURL('/admin');
  await page
    .getByRole('navigation', { name: 'Staff sections' })
    .getByRole('link', { name: 'Users' })
    .click();
  await page.getByLabel('Name, phone or email').fill(`0${pro.e164.slice(4)}`);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Pro · Active')).toBeVisible();

  await page.getByRole('button', { name: 'Suspend' }).click();
  await page.getByRole('button', { name: 'Confirm: Suspend' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Give a short reason');
  await page.getByLabel(/Reason/).fill('Customer reported a no-show twice');
  await page.getByRole('button', { name: 'Confirm: Suspend' }).click();
  await expect(page.getByRole('status')).toHaveText('Account suspended.');
  await expect(page.getByText('Pro · Suspended')).toBeVisible();
  await expect(page.getByText(/Customer reported a no-show twice/)).toBeVisible();

  // The Pro is signed out at once.
  await proPage.goto('/pro');
  await expect(proPage.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Reactivate' }).click();
  await page.getByLabel(/Reason/).fill('Cleared after speaking to both');
  await page.getByRole('button', { name: 'Confirm: Reactivate' }).click();
  await expect(page.getByText('Pro · Active')).toBeVisible();
  await proPage.close();
  noCspViolations();
});
