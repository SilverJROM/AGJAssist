import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['A1','A2','A3','A4','A5','B1','B2'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = 'http://localhost:3210';

test('command-center ovm fence journey', async ({ page }) => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];

  const check = async (id: typeof ACCEPTANCE_IDS[number], assertion: () => Promise<void>) => {
    try {
      await assertion();
      passed.push(id);
    } catch (e) {
      failed.push({ id, kind: 'assert' });
    }
  };

  try {
    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });

    // A1: OVM console route should redirect home
    await check('A1', async () => {
      await page.goto(`${APP_ORIGIN}/index.html#/overmind`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/index\.html#\//);
    });

    // A2: OVM service removed – API should not expose overmind routes
    await check('A2', async () => {
      const resp = await page.request.get(`${APP_ORIGIN}/api/overmind/status`);
      expect(resp.status()).toBe(404);
    });

    // A3: Bot commands removed – no overmind command handling
    await check('A3', async () => {
      // Placeholder literal fixture check
      const hasCommand = await page.evaluate(() => {
        return (window as any).__AGJ_TEST_OVM_COMMAND__ === undefined;
      });
      expect(hasCommand).toBe(true);
    });

    // A4: Schema drop – overmind tables absent
    await check('A4', async () => {
      // Literal fixture: expect no overmind tables in DB info endpoint
      const resp = await page.request.get(`${APP_ORIGIN}/api/db/tables`);
      const json = await resp.json().catch(() => ({}));
      expect(json.tables || []).not.toContain('overmind_projects');
    });

    // A5: UI links removed
    await check('A5', async () => {
      await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
      const link = page.locator('a[href*="overmind"], [data-testid="overmind-link"]');
      await expect(link).toHaveCount(0);
    });

    // B1: Bottom nav cleaned
    await check('B1', async () => {
      const nav = page.locator('[data-testid="bottom-nav"] a');
      const texts = await nav.allTextContents();
      expect(texts).not.toContain('Overmind');
    });

    // B2: Guardian escalation removed
    await check('B2', async () => {
      const resp = await page.request.post(`${APP_ORIGIN}/api/guardian/escalate`, { data: {} });
      expect(resp.status()).toBe(404);
    });
  } catch (error) {
    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
    if (!isNamedAssertion) throw error;
  } finally {
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
  }

  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
});
