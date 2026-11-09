import { expect, test } from '@playwright/test';
import { acceptedJob, signIn, watchCsp } from './helpers';

test('the Pro quotes with a deposit; the customer declines, then accepts and pays the deposit', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');
  const proContext = await browser.newContext();
  const proPage = await proContext.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/pro');
  // A cake: no inspection, so the Pro quotes straight away.
  const id = await acceptedJob('baker', customer.e164, pro.e164, 'Birthday cake for 30 people');
  await page.goto(`/jobs/${id}`);
  await proPage.goto(`/jobs/${id}`);

  await proPage.getByRole('button', { name: 'Send a quote' }).click();
  await proPage.getByLabel(/Price for the whole job/).fill('30000');
  await proPage.getByLabel(/Materials deposit/).fill('20000');
  await proPage.getByLabel(/What the price covers/).fill('Two-tier chocolate cake with topper');
  await proPage.getByRole('button', { name: 'Send quote' }).click();
  await expect(proPage.locator('p[role="alert"]')).toHaveText(
    'The deposit can be at most half the quote.',
  );
  await proPage.getByLabel(/Materials deposit/).fill('12000');
  await expect(
    proPage.getByText('The customer pays ₦12,000 now, then ₦18,000 after the job.'),
  ).toBeVisible();
  await proPage.getByRole('button', { name: 'Send quote' }).click();
  await expect(proPage.getByText('Your quote:')).toBeVisible();

  const card = page.locator('.quote-card').last();
  await expect(card).toContainText('₦30,000', { timeout: 10_000 });
  await expect(card).toContainText('Balance, paid after the job');
  await card.getByRole('button', { name: 'Decline' }).click();
  await expect(card).toContainText('Declined');

  await proPage.getByRole('button', { name: 'Send a quote' }).click({ timeout: 10_000 });
  await proPage.getByLabel(/Price for the whole job/).fill('28000');
  await proPage.getByLabel(/Materials deposit/).fill('10000');
  await proPage.getByLabel(/What the price covers/).fill('Two-tier cake, simpler topper');
  await proPage.getByRole('button', { name: 'Send quote' }).click();

  const second = page.locator('.quote-card', { hasText: '₦28,000' });
  await second
    .getByRole('button', { name: 'Accept and pay ₦10,000 deposit' })
    .click({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Pay ₦10,000 (test)' }).click();
  await expect(page.getByRole('status')).toContainText('deposit paid and your quote is accepted');
  await page.getByRole('link', { name: 'Back to the job chat' }).click();
  await expect(page.getByText('Quote accepted.', { exact: true })).toBeVisible();
  await expect(proPage.getByText('Quote accepted.', { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // The Pro starts the work (the deposit is paid to them), then marks it done.
  await proPage.getByRole('button', { name: 'Start work' }).click();
  await expect(proPage.locator('.chat-event').last()).toContainText(
    'The materials deposit of ₦10,000 is now paid to the Pro.',
  );
  await expect(page.getByText('Work in progress.', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await proPage.getByRole('button', { name: 'Job done' }).click();
  await expect(proPage.getByText(/pay the ₦18,000 balance/)).toBeVisible();
  await proPage.getByRole('button', { name: 'Yes, the job is done' }).click();
  await expect(proPage.getByText('The customer pays the ₦18,000 balance next.')).toBeVisible();
  await expect(page.locator('.fee-panel')).toContainText('Balance to pay: ₦18,000.', {
    timeout: 10_000,
  });
  await proContext.close();
  noCspViolations();
});
