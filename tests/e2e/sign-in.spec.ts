import { expect, test } from '@playwright/test';

// Sign-in screens on both hosts. The address used has no invitation, so nothing is emailed.
const PORTAL_BASE_URL = process.env.PLAYWRIGHT_PORTAL_BASE_URL ?? 'http://portal.localhost:3000';
const UNINVITED = 'e2e-no-access@example.com';

// Better Auth allows 5 sign-in link requests a minute per IP, and CI runs every project from one IP.
const requestsLinks = (projectName: string) => test.skip(projectName !== 'chromium', 'Sends a sign-in request');

test.describe('team host', () => {
  test('requests a sign-in link and says the same thing whether or not the address has access', async ({
    page,
  }, testInfo) => {
    requestsLinks(testInfo.project.name);
    await page.goto('/sign-in');
    await expect(page.getByText('Unbuilt OS', { exact: true })).toBeVisible();
    await page.getByLabel('Email').fill(UNINVITED);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
    await expect(page.getByText(UNINVITED)).toBeVisible();
  });

  test('keeps the destination through sign-in', async ({ page }) => {
    await page.goto('/clients?page=2');
    await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fclients%3Fpage%3D2$/);
  });

  test('explains a used or expired link', async ({ page }) => {
    await page.goto('/sign-in?error=INVALID_TOKEN');
    await expect(page.getByRole('alert')).toContainText('already been used or has expired');
  });

  test('does not serve portal routes', async ({ page }) => {
    const response = await page.goto('/portal');
    expect(response?.status()).toBe(404);
  });

  test('works from the keyboard', async ({ page }, testInfo) => {
    requestsLinks(testInfo.project.name);
    await page.goto('/sign-in');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email')).toBeFocused();
    await page.keyboard.type(UNINVITED);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  test('fits a 360px screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/sign-in');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeInViewport();
  });

  test('follows the system dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/sign-in');
    await expect(page.locator('html')).toHaveClass(/dark/);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(0, 0, 0)');
  });
});

test.describe('portal host', () => {
  test.use({ baseURL: PORTAL_BASE_URL });

  test('shows the client portal sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText('Unbuilt client portal', { exact: true })).toBeVisible();
    await expect(page.getByText(/the studio invited/)).toBeVisible();
  });

  test('does not serve team-only pages', async ({ page, request }) => {
    const response = await request.get('/setup/two-factor', { maxRedirects: 0 });
    // Without a session the proxy sends people to sign in; with one, the path resolves inside /portal and is a 404.
    expect([307, 404]).toContain(response.status());
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
