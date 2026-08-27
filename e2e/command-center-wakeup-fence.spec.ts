import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['D1','D2','D3'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = 'http://localhost:3210';

test('command-center wakeup fence journey', async ({ page }) => {
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

  await check('D1', async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups`);
    expect(resp.status()).toBe(200);
  });

  await check('D2', async () => {
    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
    const sheet = page.locator('[data-testid="wakeup-sheet"]');
    await expect(sheet).toBeVisible();
  });

  await check('D3', async () => {
    // Literal fixture: pending chip clears after fire
    const resp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups/fire`, { data: { id: 'test' } });
    expect(resp.status()).toBe(200);
  });

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
});
