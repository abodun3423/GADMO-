import { expect, test } from '@playwright/test';
import { createStaff, doneJob, signIn, staffSignIn, watchCsp } from './helpers';

test('the customer reports poor work; staff split the held payment; both see the outcome', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  const proPage = await browser.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  const jobId = await doneJob(customer.e164, pro.e164, 'Pipe under the sink is leaking');

  // The customer pays the ₦20,000 balance; GADMO holds it.
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole('button', { name: 'Pay ₦20,000' }).click();
  await page.getByRole('button', { name: 'Pay ₦20,000 (test)' }).click();
  await page.getByRole('link', { name: 'Back to the job chat' }).click();
  await expect(page.getByText('GADMO is holding the payment.')).toBeVisible();

  // The pipe still leaks: the customer reports it.
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Tell us what is wrong');
  await page
    .getByLabel(/What is wrong with the work/)
    .fill('The pipe still drips after the repair.');
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.locator('.fee-panel')).toContainText('Problem reported.');
  await proPage.goto(`/jobs/${jobId}`);
  await expect(proPage.locator('.fee-panel')).toContainText(
    'The customer reported a problem with the work.',
  );

  // Staff review the chat and split the payment.
  const staffPage = await browser.newPage();
  await staffSignIn(staffPage, await createStaff());
  await staffPage
    .getByRole('navigation', { name: 'Staff sections' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await staffPage
    .getByRole('link', { name: /Plumber/ })
    .first()
    .click();
  await expect(staffPage.getByText('Held by GADMO now: ₦20,000')).toBeVisible();
  await expect(
    staffPage.getByText('“The pipe still drips after the repair.”').first(),
  ).toBeVisible();
  await staffPage.getByRole('radio', { name: /Split it/ }).check();
  await staffPage.getByLabel(/The Pro’s share/).fill('12000');
  await staffPage
    .getByLabel(/Your decision, explained/)
    .fill('The new pipe is fitted but the joint drips; part payment is fair.');
  await staffPage.getByRole('button', { name: 'Save decision' }).click();
  await expect(staffPage.getByRole('status')).toHaveText('Settled: the payment has been split.');
  await staffPage.close();

  // Both sides see the outcome in the chat.
  await page.reload();
  await expect(page.locator('.chat-event').last()).toContainText(
    'split the payment: ₦12,000 to the Pro, ₦8,000 refunded',
  );
  await proPage.reload();
  await expect(proPage.locator('.chat-event').last()).toContainText('₦12,000 to the Pro');
  await proPage.close();
  noCspViolations();
});
