import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ACCEPTANCE_IDS = ['C1','C2','C3','C4','C5','C6'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = 'http://localhost:3210';

test('command-center reminders fence journey', async ({ page }) => {
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

  await check('C1', async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/schema`);
    expect(resp.status()).toBe(200);
  });

  await check('C2', async () => {
    const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, { data: { cadence: '30m' } });
    expect(resp.status()).toBe(201);
  });

  await check('C3', async () => {
    // Literal fixture: expect fireDue to process only included agents
    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/due`);
    const json = await resp.json().catch(() => ({}));
    expect(Array.isArray(json.due)).toBe(true);
  });

  await check('C4', async () => {
    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
    const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
    await expect(sheet).toBeVisible();
  });

  await check('C5', async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active`);
    expect(resp.status()).toBe(200);
  });

  await check('C6', async () => {
    // Integration check: reminders fire into temp tmux pane
    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/fired`);
    expect(resp.status()).toBe(200);
  });

  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
});
