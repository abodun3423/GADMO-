import { expect, test } from '@playwright/test';
import { makeVisitLate, paidVisit, signIn, watchCsp } from './helpers';

test('a late Pro: the customer waits 30 minutes, then cancels with the fee refunded and the request goes to another Pro', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  const proContext = await browser.newContext();
  const proPage = await proContext.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await page.goto('/signin');
  const customer = await signIn(page);
  const jobId = await paidVisit(customer.e164, pro.e164, 'The lights keep tripping off', 20);

  // Before the time is up, both sides see when the Pro must arrive by.
  await proPage.goto(`/jobs/${jobId}`);
  await expect(proPage.getByText(/Arrive and enter the code by/)).toBeVisible();
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByText(/Your Pro should arrive by/)).toBeVisible();
  await expect(page.getByRole('button', { name: /My Pro didn’t come/ })).toHaveCount(0);

  // Time is up and the Pro is on the way: the customer waits a little longer.
  await makeVisitLate(jobId);
  await page.reload();
  const late = page.getByRole('region', { name: /Your Pro hasn’t arrived yet/ });
  await expect(late).toContainText('They said they are on the way.');
  await late.getByRole('button', { name: 'Wait 30 more minutes' }).click();
  await expect(page.getByText(/The customer will wait 30 more minutes/)).toBeVisible();
  await expect(late).toHaveCount(0);

  // Still no Pro: cancel and get the fee back; the request opens again for other Pros.
  await makeVisitLate(jobId);
  await page.reload();
  await page.getByRole('button', { name: 'My Pro didn’t come: refund ₦1,500' }).click();
  await expect(page).not.toHaveURL(new RegExp(jobId));
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);

  // The customer can still cancel the new request.
  await page.goto('/jobs');
  // Newest first: the new request, open for other Pros.
  const fresh = page.locator('article', { hasText: 'The lights keep tripping off' }).first();
  await expect(fresh).toContainText('No Pro available yet');
  await fresh.getByRole('button', { name: 'Cancel request' }).click();
  await fresh.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(fresh).toContainText('Cancelled');

  await page.goto(`/jobs/${jobId}`);
  await expect(
    page.getByText(/₦1,500 was refunded to the customer’s GADMO wallet/).first(),
  ).toBeVisible();
  await proContext.close();
  noCspViolations();
});
