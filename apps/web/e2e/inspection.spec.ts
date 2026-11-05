import { expect, test } from '@playwright/test';
import { acceptedJob, signIn, watchCsp } from './helpers';

test('the Pro offers an inspection fee, the customer counters, the Pro accepts', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');

  const proPage = await browser.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/pro');

  const id = await acceptedJob('plumber', customer.e164, pro.e164, 'Leaking pipe under the sink');

  // The customer is told the Pro will offer a fee; there is nothing to fill in yet.
  await page.goto(`/jobs/${id}`);
  await expect(page.getByText('Your Pro will offer an inspection fee here')).toBeVisible();

  // The Pro offers ₦2,500, explaining why. Over ₦5,000 is refused on the spot.
  await proPage.goto(`/jobs/${id}`);
  await proPage.getByLabel(/Inspection fee/).fill('6000');
  await proPage.getByRole('button', { name: 'Send offer' }).click();
  await expect(proPage.locator('p[role="alert"]')).toHaveText(
    'The inspection fee can’t be more than ₦5,000.',
  );
  await proPage.getByLabel(/Inspection fee/).fill('2500');
  await proPage.getByLabel(/Why this amount/).fill('About 8 km away');
  await proPage.getByRole('button', { name: 'Send offer' }).click();
  await expect(proPage.getByText('Your offer:')).toBeVisible();
  await expect(proPage.getByText('Waiting for an answer', { exact: true })).toBeVisible();

  // The customer counters with ₦1,500.
  const offer = page.locator('.offer-card', { hasText: '₦2,500' });
  await expect(offer).toContainText('About 8 km away', { timeout: 10_000 });
  await offer.getByRole('button', { name: 'Counter' }).click();
  await offer.getByLabel(/Your counter-offer/).fill('1500');
  await offer.getByRole('button', { name: 'Send counter-offer' }).click();
  await expect(offer).toContainText('Countered');

  // The Pro accepts the counter-offer; both see the agreed fee.
  const counter = proPage.locator('.offer-card', { hasText: '₦1,500' });
  await counter.getByRole('button', { name: 'Accept ₦1,500' }).click({ timeout: 10_000 });
  await expect(proPage.getByText('Inspection fee agreed: ₦1,500.').first()).toBeVisible();
  await expect(page.getByText('Inspection fee agreed: ₦1,500.').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(proPage.getByText(/Waiting for the customer to pay it/)).toBeVisible();

  // The first try fails; nothing is paid and the customer can try again.
  await page.getByRole('button', { name: 'Pay ₦1,500 now' }).click();
  await expect(page).toHaveURL(/\/pay\/test\?reference=gadmo_/);
  await expect(page.getByText('No real money moves.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Make the payment fail' }).click();
  await expect(page.getByRole('heading', { name: 'Payment didn’t go through' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the job chat' }).click();
  await expect(page).toHaveURL(`/jobs/${id}`);

  // The second try succeeds. GADMO holds the fee until the Pro arrives.
  await page.getByRole('button', { name: 'Pay ₦1,500 now' }).click();
  await page.getByRole('button', { name: 'Pay ₦1,500 (test)' }).click();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(
    '₦1,500 paid. GADMO holds it until your Pro arrives.',
  );
  await page.getByRole('link', { name: 'Back to the job chat' }).click();
  await expect(page.getByText('Inspection fee paid: ₦1,500.', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'Inspection fee paid: ₦1,500. GADMO holds it until the Pro arrives and enters the customer’s arrival code.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay ₦1,500 now' })).toHaveCount(0);
  await expect(proPage.getByText(/releases it to\s+you when you arrive/)).toBeVisible({
    timeout: 10_000,
  });

  // The visit: the Pro is on the way, then enters the customer's arrival code.
  const code = (await page.getByLabel('Your arrival code').textContent())!.trim();
  expect(code).toMatch(/^\d{4}$/);
  await expect(proPage.getByText(code)).toHaveCount(0);
  await proPage.getByRole('button', { name: 'I’m on my way' }).click();
  await expect(page.getByText('Your Pro is on the way.').first()).toBeVisible({ timeout: 10_000 });
  await expect(proPage.getByText('Your customer knows you’re on the way.')).toBeVisible();
  await proPage.getByRole('button', { name: 'I have arrived' }).click();
  await proPage
    .getByLabel(/Enter the customer’s arrival code/)
    .fill(code === '0000' ? '1111' : '0000');
  await proPage.getByRole('button', { name: 'Confirm arrival and get ₦1,500' }).click();
  await expect(proPage.locator('p[role="alert"]')).toContainText('That code isn’t right.');
  await proPage.getByLabel(/Enter the customer’s arrival code/).fill(code);
  await proPage.getByRole('button', { name: 'Confirm arrival and get ₦1,500' }).click();
  await expect(proPage.getByText('Arrival confirmed.')).toBeVisible();
  await expect(proPage.getByText(/now yours, in your GADMO earnings/)).toBeVisible();
  await expect(page.getByText('Your Pro has arrived.', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByLabel('Your arrival code')).toHaveCount(0);
  await proPage.close();
  noCspViolations();
});

test('services without an inspection fee say so', async ({ page, browser }) => {
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');
  const proPage = await browser.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/pro');
  await proPage.close();
  const id = await acceptedJob('baker', customer.e164, pro.e164, 'Birthday cake for 20 people');
  await page.goto(`/jobs/${id}`);
  await expect(page.getByText('No inspection fee for this service.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send offer' })).toHaveCount(0);
});
