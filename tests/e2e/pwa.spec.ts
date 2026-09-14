import { expect, test } from '@playwright/test';

// The installable app: a manifest per host, the service worker and the offline page, all reachable without a session.
const PORTAL_BASE_URL = process.env.PLAYWRIGHT_PORTAL_BASE_URL ?? 'http://portal.localhost:3000';

test('the team app has its own manifest', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: 'Unbuilt OS', start_url: '/', display: 'standalone' });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
});

test('the portal has its own manifest', async ({ playwright }) => {
  const portal = await playwright.request.newContext({ baseURL: PORTAL_BASE_URL });
  const manifest = await (await portal.get('/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Unbuilt client portal');
  await portal.dispose();
});

test('the service worker is served fresh on both hosts', async ({ request, playwright }) => {
  const team = await request.get('/sw.js');
  expect(team.status()).toBe(200);
  expect(team.headers()['cache-control']).toContain('no-store');

  const portal = await playwright.request.newContext({ baseURL: PORTAL_BASE_URL });
  expect((await portal.get('/sw.js')).status()).toBe(200);
  await portal.dispose();
});

test('the offline page needs no session', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
});

test('icons referenced by the manifest exist', async ({ request }) => {
  for (const path of ['/icon-192.png', '/icon-512.png', '/icon.svg']) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});
