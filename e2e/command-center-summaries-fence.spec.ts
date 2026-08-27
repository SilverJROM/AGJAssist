import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['E1','E2','E3','F1','F2','F3'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = 'http://localhost:3210';

test('command-center summaries fence journey', async ({ page }) => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];

  const check = async (id: typeof ACCEPTANCE_IDS[number], assertion: () => Promise<void>) => {
    try {
      await assertion();
      passed.push(id);
    } catch {
      failed.push({ id, kind: 'assert' });
      throw new Error(`FENCE_ASSERT:${id}`);
    }
  };

  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });

  await check('E1', async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
    expect(resp.status()).toBe(200);
  });

  await check('E2', async () => {
    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
    const dropdown = page.locator('[data-testid="agent-summaries-dropdown"]');
    await expect(dropdown).toBeVisible();
  });

  await check('E3', async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-summaries`);
    expect(resp.status()).toBe(200);
  });

  await check('F1', async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
    const json = await resp.json().catch(() => ({}));
    expect(json.endpoints?.some((e:any)=>e.label==='140')).toBe(true);
  });

  await check('F2', async () => {
    // Literal fixture check for endpoint config
    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints/default`);
    expect(resp.status()).toBe(200);
  });

  await check('F3', async () => {
    await page.goto(`${APP_ORIGIN}/index.html#/settings/summary`, { waitUntil: 'domcontentloaded' });
    const settings = page.locator('[data-testid="summary-endpoint-settings"]');
    await expect(settings).toBeVisible();
  });

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
});
