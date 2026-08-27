import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'b1-e2e-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'b1-e2e', role: 'owner' }));
  });
});

const BASE = 'http://localhost:3210';

test('B1 redirect overmind hashes to home', async ({ page }) => {
  const hashes = ['#/overmind', '#/overmind-projects', '#/conversations', '#/overmind-xyz'];
  for (const h of hashes) {
    await page.goto(`${BASE}/index.html${h}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toBe(`${BASE}/index.html#/`);
  }
});

test('B1 header and nav cleaned', async ({ page }) => {
  await page.goto(`${BASE}/index.html#/`, { waitUntil: 'domcontentloaded' });
  const texts = await page.locator('nav.nav-links a').allTextContents();
  expect(texts).not.toContain('Workflows');
  expect(texts).not.toContain('OVM Projects');
  expect(texts).not.toContain('Chat');
  await expect(page.locator('.overmind-page')).toHaveCount(0);
  const workflowsCount = await page.locator('text=Workflows').count();
  expect(workflowsCount).toBe(0);
});
