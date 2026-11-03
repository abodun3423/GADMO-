import { expect, test } from '@playwright/test';
import { approvePro, insertJob, signIn, watchCsp } from './helpers';

test('a Pro sets up, gets verified, goes online and sees a nearby request', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);

  // A customer somewhere in Ado-Ekiti needs an electrician.
  const customerPage = await browser.newPage();
  await customerPage.goto('/signin');
  const customer = await signIn(customerPage, 'customer');
  await expect(customerPage).toHaveURL('/');
  await customerPage.close();
  await insertJob('electrician', customer.e164, 'Sockets in the kitchen stopped working');

  await page.goto('/signin');
  const pro = await signIn(page, 'pro');
  await expect(page).toHaveURL('/pro');
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go online' })).toBeDisabled();

  await page.getByRole('link', { name: 'Set up your profile' }).click();
  await page.getByLabel('Search skills').fill('electrician');
  await page.getByRole('checkbox', { name: 'Electrician', exact: true }).check();
  await page.getByRole('radio', { name: /Ado-Ekiti/ }).check();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');

  // Still not verified: can't go online.
  await page.getByRole('link', { name: 'Go to Pro home' }).click();
  await expect(page.getByText('Identity check not done yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go online' })).toBeDisabled();

  await approvePro(pro.e164);
  await page.reload();
  await expect(page.getByText('Verified. Customers see your verified badge.')).toBeVisible();
  await page.getByRole('button', { name: 'Go online' }).click();
  await expect(page.getByRole('heading', { name: 'You’re online' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requests near you' })).toBeVisible();
  const request = page.locator('article', { hasText: 'Sockets in the kitchen stopped working' });
  await expect(request).toBeVisible();
  await expect(request).toContainText('Emergency');
  await expect(request).toContainText(/About \d+(\.5)? km away/);

  await page.getByRole('button', { name: 'Go offline' }).click();
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
  await expect(request).toHaveCount(0);
  noCspViolations();
});
