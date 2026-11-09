import { expect, test } from '@playwright/test';
import { watchCsp } from './helpers';

test('home shows the catalogue, emergency help and search', async ({ page }) => {
  const noCspViolations = watchCsp(page);
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'The right skills. Within reach.' }),
  ).toBeVisible();
  const emergency = page.getByRole('region', { name: /Stuck\? Get help now/ });
  await expect(emergency.getByRole('link')).toHaveCount(9);
  await expect(emergency.getByRole('link', { name: 'Electrician', exact: true })).toBeVisible();

  // 12 group tiles; opening one shows its services with their inspection rule.
  await expect(page.locator('.tiles button')).toHaveCount(12);
  const tech = page.getByRole('button', { name: /Tech & digital/ });
  await tech.click();
  await expect(tech).toHaveAttribute('aria-expanded', 'true');
  const webDev = page.getByRole('link', { name: /Website developer/ });
  await expect(webDev).toBeVisible();
  await expect(webDev).toContainText('No inspection fee');
  await tech.click();
  await expect(webDev).toBeHidden();

  // How it works and the invitation to Pros are always there.
  await expect(page.getByRole('heading', { name: 'How GADMO works' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join as a Pro' })).toHaveAttribute(
    'href',
    '/signin',
  );

  // Search narrows to matching services.
  await page.getByRole('searchbox', { name: 'Search services' }).fill('plumb');
  await expect(page.getByRole('heading', { name: '1 service found' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Plumber/ })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search services' }).fill('zzzz');
  await expect(page.getByRole('heading', { name: /No service matches/ })).toBeVisible();

  noCspViolations();
});

test('pages are protected by a strict Content Security Policy and security headers', async ({
  page,
}) => {
  const response = await page.goto('/');
  const headers = response!.headers();
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();

  // A fresh nonce on every page load.
  const again = (await page.goto('/'))!.headers()['content-security-policy'];
  expect(again).not.toBe(csp);
});

test('the app can be installed: manifest, icons and offline page', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'GADMO', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
  expect((await request.get('/sw.js')).status()).toBe(200);

  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible();
});
