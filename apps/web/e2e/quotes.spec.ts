import { expect, test } from '@playwright/test';
import { acceptedJob, signIn, watchCsp } from './helpers';

test('the customer pays the whole quote on accepting; after “Job done” they release it when satisfied', async ({
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
    proPage.getByText(
      'The customer pays ₦30,000 when accepting. ₦12,000 comes to you at once for materials; GADMO holds ₦18,000 and pays you after the job.',
    ),
  ).toBeVisible();
  await proPage.getByRole('button', { name: 'Send quote' }).click();
  await expect(proPage.getByText('Your quote:')).toBeVisible();

  const card = page.locator('.quote-card').last();
  await expect(card).toContainText('₦30,000', { timeout: 10_000 });
  await expect(card).toContainText('Held by GADMO until the job is done');
  await card.getByRole('button', { name: 'Decline' }).click();
  await expect(card).toContainText('Declined');

  await proPage.getByRole('button', { name: 'Send a quote' }).click({ timeout: 10_000 });
  await proPage.getByLabel(/Price for the whole job/).fill('28000');
  await proPage.getByLabel(/Materials deposit/).fill('10000');
  await proPage.getByLabel(/What the price covers/).fill('Two-tier cake, simpler topper');
  await proPage.getByRole('button', { name: 'Send quote' }).click();

  const second = page.locator('.quote-card', { hasText: '₦28,000' });
  await second.getByRole('button', { name: 'Accept and pay ₦28,000' }).click({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Pay ₦28,000 (test)' }).click();
  await expect(page.getByRole('status')).toContainText('₦28,000 paid and your quote is accepted');
  await page.getByRole('link', { name: 'Back to the job chat' }).click();
  await expect(page.getByText('Quote accepted.', { exact: true })).toBeVisible();
  await expect(proPage.getByText('Quote accepted.', { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // The deposit went straight to the Pro; GADMO holds the rest. They start, then finish.
  await expect(proPage.locator('.chat-event', { hasText: 'accepted and paid' })).toContainText(
    'Quote of ₦28,000 accepted and paid: ₦10,000 materials deposit to the Pro now; GADMO holds ₦18,000 until the job is done.',
  );
  await proPage.getByRole('button', { name: 'Start work' }).click();
  await expect(proPage.locator('.chat-event').last()).toHaveText(
    /^Your Pro has started the work\./,
  );
  await expect(page.getByText('Work in progress.', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await proPage.getByRole('button', { name: 'Job done' }).click();
  await expect(
    proPage.getByText(/GADMO pays you the ₦18,000 balance when they release it/),
  ).toBeVisible();
  await proPage.getByRole('button', { name: 'Yes, the job is done' }).click();
  await expect(proPage.getByText('Payment held by GADMO.')).toBeVisible();

  // The customer is asked straight away whether they are satisfied, and releases the payment.
  const ask = page.getByRole('dialog', { name: 'Are you satisfied with the work?' });
  await expect(ask).toBeVisible({ timeout: 10_000 });
  await expect(ask).toContainText('GADMO is holding ₦18,000 for them');
  await expect(ask).toContainText('releases it automatically at');
  await ask.getByRole('button', { name: 'Yes, release ₦18,000 to my Pro' }).click();
  await expect(page.locator('.fee-panel')).toContainText(
    'Job complete. Thank you for using GADMO.',
  );
  await expect(proPage.getByText('See your wallet for what GADMO paid you.')).toBeVisible({
    timeout: 10_000,
  });

  // Each side rates the other. The customer's rating shows without their name.
  const rate = page.getByRole('group', { name: /How did your Pro do\?/ });
  await page.getByRole('button', { name: 'Send rating' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Choose from 1 to 5 stars.');
  await rate.locator('label', { hasText: '4 stars' }).click();
  await page.getByLabel(/Tell other customers about the work/).fill('Tidy and on time.');
  await page.getByRole('button', { name: 'Send rating' }).click();
  await expect(page.getByText(/You rated this Pro/)).toBeVisible();
  await expect(page.getByLabel('4 out of 5 stars')).toBeVisible();

  await proPage.reload();
  await expect(proPage.getByRole('group', { name: /How was this customer\?/ })).toContainText(
    'Only GADMO staff see this.',
  );
  await proPage.locator('.star', { hasText: '5 stars' }).click();
  await proPage.getByRole('button', { name: 'Send rating' }).click();
  await expect(proPage.getByText(/You rated this customer/)).toBeVisible();
  await proContext.close();
  noCspViolations();
});
