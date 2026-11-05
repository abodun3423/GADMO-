import { expect, test } from '@playwright/test';
import { approvePro, createStaff, insertJob, signIn, staffSignIn, watchCsp } from './helpers';

test('staff see which Pros can take a job, and why the others can’t', async ({ page, browser }) => {
  const noCspViolations = watchCsp(page);
  // A Pro who offers the service and works in Ado-Ekiti, but isn't verified yet.
  const proPage = await browser.newPage();
  await proPage.goto('/signin?next=/account/profile');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/account/profile');
  const name = `Tunde ${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
  await proPage.getByLabel(/Full name/).fill(name);
  await proPage.getByRole('button', { name: 'Save' }).click();
  await expect(proPage.getByRole('status')).toHaveText('Saved.');
  await proPage.goto('/pro/profile');
  await proPage.getByLabel('Search skills').fill('carpenter');
  await proPage.getByRole('checkbox', { name: 'Carpenter', exact: true }).check();
  await proPage.getByRole('radio', { name: /Ado-Ekiti/ }).check();
  await proPage.getByRole('button', { name: 'Save profile' }).click();
  await expect(proPage.getByRole('status')).toContainText('Profile saved.');
  await proPage.close();

  const customerPage = await browser.newPage();
  await customerPage.goto('/signin');
  const customer = await signIn(customerPage, 'customer');
  await customerPage.close();
  const id = await insertJob('carpenter', customer.e164, 'Wardrobe door is off', 'SCHEDULED');

  await staffSignIn(page, await createStaff());
  await expect(page).toHaveURL('/admin');
  await page.goto(`/admin/jobs/${id}`);
  const row = page.locator('.job', { hasText: name });
  await expect(row).toContainText('Can’t take it');
  await expect(row).toContainText('Identity not approved yet (Not verified).');

  await approvePro(pro.e164);
  await page.reload();
  await expect(row).toContainText('Can take it');
  await expect(row.locator('.issues')).toHaveCount(0);
  noCspViolations();
});
