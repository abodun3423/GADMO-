import { expect, test } from '@playwright/test';
import { pushSubscriptionsOf, signIn, watchCsp } from './helpers';

/**
 * Real push services (Google's, Apple's, Mozilla's) aren't reachable from tests, so the
 * browser's permission prompt and push subscription are stood in for; everything from
 * there on (saving it for the account, forgetting it on sign-out) is the real thing.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default';
    let current: PushSubscription | null = null;
    Object.defineProperty(Notification, 'permission', { get: () => permission });
    Notification.requestPermission = async () => (permission = 'granted');
    const fake = (): PushSubscription => {
      const endpoint = `https://push.example.test/${Math.random().toString(36).slice(2)}`;
      return {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'BTestKey_-', auth: 'testAuth' } }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      } as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async () => current;
    PushManager.prototype.subscribe = async () => (current = fake());
  });
});

test('a customer turns on alerts; the browser is saved for their account', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/signin?next=/jobs');
  const customer = await signIn(page, 'customer');
  await expect(page).toHaveURL('/jobs');
  const prompt = page.getByRole('region', { name: 'Alerts' });
  await expect(prompt).toContainText('Turn on alerts');
  await prompt.getByRole('button', { name: 'Turn on alerts' }).click();
  await expect(prompt).toHaveCount(0);
  await expect.poll(() => pushSubscriptionsOf(customer.e164)).toBe(1);

  // Signing out stops this browser getting the account's alerts.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => pushSubscriptionsOf(customer.e164)).toBe(0);
  noCspViolations();
});

test('a Pro is invited to turn on alerts on Pro home', async ({ page }) => {
  await page.goto('/signin');
  await signIn(page, 'pro');
  await expect(page).toHaveURL('/pro');
  await expect(page.getByRole('region', { name: 'Alerts' })).toContainText(
    'emergency requests near you',
  );
});
