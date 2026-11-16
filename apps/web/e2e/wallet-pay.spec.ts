import { expect, test } from '@playwright/test';
import { acceptedJob, agreeFee, fundWallet, signIn, watchCsp } from './helpers';

test('the customer pays from their GADMO wallet: all of it at once, or part with the card paying the rest', async ({
  page,
}) => {
  const noCspViolations = watchCsp(page);
  const proPage = await page.context().browser()!.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await proPage.close();
  await page.goto('/signin');
  const customer = await signIn(page);

  // The wallet covers the whole fee: paid at once, no card.
  await fundWallet(customer.e164, 200_000);
  const first = await acceptedJob('electrician', customer.e164, pro.e164, 'Socket sparks');
  await agreeFee(first, 150_000);
  await page.goto(`/jobs/${first}`);
  const box = page.getByRole('checkbox', { name: /Use ₦1,500 from my GADMO wallet/ });
  await expect(box).toBeChecked();
  await expect(page.getByText('Your wallet covers it all, so no card is needed.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₦1,500 from my wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Paid from your GADMO wallet.');

  // ₦500 left: it pays part, the card the other ₦1,000. Unticking keeps the wallet.
  const second = await acceptedJob('electrician', customer.e164, pro.e164, 'Fan not working');
  await agreeFee(second, 150_000);
  await page.goto(`/jobs/${second}`);
  const part = page.getByRole('checkbox', { name: /Use ₦500 from my GADMO wallet/ });
  await expect(page.getByText('Your card pays the other ₦1,000.')).toBeVisible();
  await part.uncheck();
  await expect(page.getByRole('button', { name: 'Pay ₦1,500' })).toBeVisible();
  await part.check();
  await page.getByRole('button', { name: 'Pay ₦1,000 by card' }).click();
  await expect(page.getByRole('heading', { name: 'Test payment' })).toBeVisible();
  await expect(page.getByText('₦500 comes from the GADMO wallet.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₦1,000 (test)' }).click();
  await expect(page.getByRole('status')).toContainText('₦500 came from your GADMO wallet.');

  // The wallet is now empty, so no choice is shown.
  const third = await acceptedJob('electrician', customer.e164, pro.e164, 'Light flickers');
  await agreeFee(third, 150_000);
  await page.goto(`/jobs/${third}`);
  await expect(page.getByRole('button', { name: 'Pay ₦1,500' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  noCspViolations();
});
