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
  await expect(page.getByText(/You’ll pay it in the app before the visit/)).toBeVisible();
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
