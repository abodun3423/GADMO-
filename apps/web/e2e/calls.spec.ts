import { expect, test } from '@playwright/test';
import { acceptedJob, signIn, watchCsp } from './helpers';

test('the customer calls the Pro inside GADMO; they talk, then hang up', async ({
  page,
  browser,
}) => {
  const noCspViolations = watchCsp(page);
  await page.context().grantPermissions(['microphone']);
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');

  const proContext = await browser.newContext({ permissions: ['microphone'] });
  const proPage = await proContext.newPage();
  await proPage.goto('/signin');
  const pro = await signIn(proPage, 'pro');
  await expect(proPage).toHaveURL('/pro');
  const id = await acceptedJob('electrician', customer.e164, pro.e164, 'Lights keep tripping');

  await page.goto(`/jobs/${id}`);
  await proPage.goto(`/jobs/${id}`);

  await page.getByRole('button', { name: '📞 Call your Pro' }).click();
  await expect(page.getByText('Calling your Pro…')).toBeVisible();

  await expect(proPage.getByText('Your customer is calling')).toBeVisible({ timeout: 15_000 });
  await proPage.getByRole('button', { name: 'Answer' }).click();
  await expect(proPage.getByText(/On call · \d:\d\d/)).toBeVisible();
  await expect(page.getByText(/On call · \d:\d\d/)).toBeVisible({ timeout: 10_000 });

  // The two browsers really are connected.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (document.querySelector('.call-panel audio') as HTMLAudioElement | null)?.srcObject !==
            null,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Mute' }).click();
  await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();
  await page.getByRole('button', { name: 'Hang up' }).click();
  await expect(page.getByRole('button', { name: '📞 Call your Pro' })).toBeVisible();
  await expect(proPage.getByText('Call ended.', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^Call ended · \d:\d\d$/)).toBeVisible({ timeout: 10_000 });

  // A declined call.
  await proPage.getByRole('button', { name: '📞 Call your customer' }).click();
  await expect(page.getByText('Your Pro is calling')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(proPage.getByText('Your customer can’t talk right now.')).toBeVisible({
    timeout: 10_000,
  });
  await proContext.close();
  noCspViolations();
});
