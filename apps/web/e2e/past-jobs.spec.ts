import { expect, test } from '@playwright/test';
import { finishJob, insertJob, signIn, watchCsp } from './helpers';

test('both sides can reopen a finished job and read their chat history', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  const customerPage = await browser.newPage();
  await customerPage.goto('/signin?next=/jobs');
  const customer = await signIn(customerPage, 'customer');

  await page.goto('/signin');
  const pro = await signIn(page, 'pro');
  await expect(page).toHaveURL('/pro');

  const jobId = await insertJob('plumber', customer.e164, 'Kitchen tap is leaking', 'SCHEDULED');
  await finishJob(jobId, pro.e164, 'Thank you, the tap works perfectly now.');

  // The Pro finds it under Past jobs and reads the chat.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your jobs' })).toHaveCount(0);
  await page.getByText('Past jobs (1)').click();
  await page
    .locator('article', { hasText: 'Kitchen tap is leaking' })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(`/jobs/${jobId}`);
  await expect(page.getByText('Thank you, the tap works perfectly now.')).toBeVisible();

  // The customer finds the same chat from My jobs.
  await customerPage.goto('/jobs');
  await customerPage
    .locator('article', { hasText: 'Kitchen tap is leaking' })
    .getByRole('link')
    .first()
    .click();
  await expect(customerPage).toHaveURL(`/jobs/${jobId}`);
  await expect(customerPage.getByText('Thank you, the tap works perfectly now.')).toBeVisible();
  noCspViolations();
});
