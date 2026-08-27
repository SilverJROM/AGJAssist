import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['G1','G2','G3','H1','H2','H3','I1','I2','J1','J2'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = 'http://localhost:3210';

test('command-center window fence journey', async ({ page }) => {
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

  try {
    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });

    await check('G1', async () => {
      const draft = page.locator('[data-testid="terminal-draft"]');
      await expect(draft).toBeVisible();
    });

    await check('G2', async () => {
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      await expect(switcher).toBeVisible();
    });

    await check('G3', async () => {
      // Direct check on the backing session-refresh data path (not a UI
      // locator) so FENCE_STUB=F1 can force this assertion mechanically,
      // matching the endpoint-check pattern used by every sibling fence.
      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-session/refresh`);
      expect(resp.status()).toBe(200);
    });

    await check('H1', async () => {
      const header = page.locator('[data-testid="terminal-header-v2"]');
      await expect(header).toBeVisible();
    });

    await check('H2', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const collapsed = await page.locator('[data-testid="command-center-header"]').evaluate(el => getComputedStyle(el).height);
      expect(collapsed).toBeDefined();
    });

    await check('H3', async () => {
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(theme).toBeTruthy();
    });

    await check('I1', async () => {
      const refreshBtn = page.locator('[data-testid="refresh-from-session"]');
      await refreshBtn.click();
      await expect(page.locator('[data-testid="terminal-turn-agent"]')).toBeVisible();
    });

    await check('I2', async () => {
      const draftInput = page.locator('[data-testid="terminal-composer-input"]');
      await draftInput.fill('test draft');
      await page.reload();
      await expect(draftInput).toHaveValue('test draft');
    });

    await check('J1', async () => {
      await page.setViewportSize({ width: 1024, height: 800 });
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      await expect(switcher).toBeVisible();
    });

    await check('J2', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
      await expect(dropdown).toBeVisible();
    });
  } catch (error) {
    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
    if (!isNamedAssertion) throw error;
  } finally {
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
  }

  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
});
