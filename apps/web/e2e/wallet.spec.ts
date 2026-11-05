import { expect, test } from '@playwright/test';
import { creditProWallet, signIn, watchCsp } from './helpers';

test('a Pro adds a bank account and withdraws earnings; history shows both', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/account');
  const pro = await signIn(page, 'pro');
  await creditProWallet(pro.e164, 500_000);
  await page.reload();
  await expect(page.getByText('₦5,000').first()).toBeVisible();
  await page.getByRole('link', { name: /Available balance/ }).click();
  await expect(page).toHaveURL('/account/wallet');
  await expect(page.getByText('Add your bank account below to withdraw.')).toBeVisible();

  // The account must exist at the bank.
  await page.getByLabel('Bank').selectOption({ label: 'Access Bank' });
  await page.getByLabel('Account number').fill('0001234567');
  await page.getByRole('button', { name: 'Save bank account' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('couldn’t find that account');
  await page.getByLabel('Account number').fill('0123456789');
  await page.getByRole('button', { name: 'Save bank account' }).click();
  await expect(page.getByText('Access Bank ••••6789').first()).toBeVisible();
  await expect(page.getByText('Account name: TEST ACCOUNT HOLDER')).toBeVisible();

  await page.getByLabel(/Amount/).fill('500');
  await page.getByRole('button', { name: /Withdraw to Access Bank/ }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('You can withdraw ₦1,000 or more.');
  await page.getByLabel(/Amount/).fill('2000');
  await page.getByRole('button', { name: /Withdraw to Access Bank/ }).click();
  await expect(page.getByRole('status')).toHaveText('Sent to Access Bank ••••6789.');
  await expect(page.locator('.wallet-balance')).toHaveText('₦3,000');
  await expect(page.getByText('Withdrawal to Access Bank ••••6789')).toBeVisible();
  await expect(page.getByText('+₦5,000')).toBeVisible();
  noCspViolations();
});
