import { expect, test } from '@playwright/test';
import { approvePro, insertJob, signIn, watchCsp } from './helpers';

test('a verified Pro goes online, gets an emergency offer with a countdown, and accepts it', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);

  // A customer somewhere in Ado-Ekiti needs an electrician.
  const customerPage = await browser.newPage();
  await customerPage.goto('/signin?next=/jobs');
  const customer = await signIn(customerPage, 'customer');
  await expect(customerPage).toHaveURL('/jobs');
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

  // Coming online, the Pro is offered the open emergency straight away.
  const offer = page.getByRole('region', { name: 'Emergency request for you' });
  await expect(offer).toContainText('Sockets in the kitchen stopped working');
  await expect(offer.getByRole('timer')).toHaveText(/^[12]:\d\d left to accept$/);
  await expect(offer).toContainText(/About \d+(\.5)? km away/);

  // Meanwhile the customer sees that a Pro is being asked.
  await customerPage.reload();
  await expect(customerPage.getByText('Finding a Pro near you…')).toBeVisible();

  await offer.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('status')).toHaveText('Job accepted. It’s in Your jobs below.');
  await expect(offer).toHaveCount(0);
  await expect(
    page.locator('article', { hasText: 'Sockets in the kitchen stopped working' }),
  ).toContainText('You accepted.');

  await customerPage.reload();
  await expect(customerPage.getByText(/^A Pro accepted\./)).toBeVisible();
  await customerPage.close();
  noCspViolations();
});

test('with no Pro available the request stays open, and the customer can cancel it', async ({
  page,
}) => {
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');
  // No locksmith is online in this test run: nobody to offer it to.
  await insertJob('locksmith', customer.e164, 'Locked out of my flat with the baby inside');
  await page.reload();
  const job = page.locator('article', { hasText: 'Locked out of my flat' });
  await expect(job).toContainText('No Pro available yet');

  await job.getByRole('button', { name: 'Cancel request' }).click();
  await job.getByRole('button', { name: 'Keep it' }).click();
  await expect(job).toContainText('No Pro available yet');
  await job.getByRole('button', { name: 'Cancel request' }).click();
  await job.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(job).toContainText('Cancelled');
  await expect(job.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
});
