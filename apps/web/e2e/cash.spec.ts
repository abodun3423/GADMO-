import { expect, test } from '@playwright/test';
import { doneJob, signIn, watchCsp } from './helpers';

test('the customer accepts the cash agreement; the Pro confirms the cash; the job closes', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  const proPage = await browser.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  const jobId = await doneJob(customer.e164, pro.e164, 'Bathroom tap replaced');

  await page.goto(`/jobs/${jobId}`);
  await page.getByRole('button', { name: 'Pay in cash instead' }).click();
  await expect(page.getByText('Cash is not protected.')).toBeVisible();
  const pay = page.getByRole('button', { name: 'Pay ₦20,000 in cash' });
  await expect(pay).toBeDisabled(); // the agreement must be ticked first
  await page.getByRole('checkbox', { name: /GADMO does not hold this money/ }).check();
  await pay.click();
  await expect(page.locator('.fee-panel')).toContainText('Paying ₦20,000 in cash.');
  await expect(page.getByRole('button', { name: 'Pay ₦20,000 in the app instead' })).toBeVisible();

  await proPage.goto(`/jobs/${jobId}`);
  await expect(proPage.locator('.fee-panel')).toContainText(
    'The customer is paying the ₦20,000 balance in cash.',
  );
  await expect(proPage.getByLabel('Cash you received (₦)')).toHaveValue('20000');
  await proPage.getByRole('button', { name: 'Confirm cash received' }).click();
  await expect(proPage.locator('.fee-panel')).toContainText('Job complete. Paid in cash.');

  await page.reload();
  await expect(page.locator('.fee-panel')).toContainText('Job complete. Paid in cash.');
  await expect(page.locator('.chat-event').last()).toContainText(
    'The Pro confirmed receiving ₦20,000 in cash.',
  );
  await proPage.close();
  noCspViolations();
});
