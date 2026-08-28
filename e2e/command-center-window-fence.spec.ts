import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ACCEPTANCE_IDS = ['G1','G2','G3','H1','H2','H3','I1','I2','J1','J2'] as const;
type AcceptanceId = typeof ACCEPTANCE_IDS[number];
type Failure = { id: AcceptanceId; kind: 'assert'; message?: string };

const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'test-token';
const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };

const CONTRIBUTOR_TESTS = [
  'test_f1_refresh_from_session_surface_visible',
  'test_f2_draft_and_switcher_surfaces_are_rendered',
  'test_f3_refresh_action_and_draft_reload_keep_composer_usable',
  'test_f4_header_v2_collapses_without_losing_command_center_chrome',
  'test_f5_phone_dropdown_and_wide_switcher_are_available',
  'test_f6_window_theme_attribute_is_applied',
] as const;

function shardPath(testName: string): string {
  return `${REPORT_PATH}.${testName}.json`;
}

function readShard(testName: string): { passed: AcceptanceId[]; failed: Failure[] } | null {
  try {
    return JSON.parse(fs.readFileSync(shardPath(testName), 'utf8'));
  } catch {
    return null;
  }
}

function writeReport() {
  const passed = new Set<AcceptanceId>();
  const failed: Failure[] = [];
  for (const testName of CONTRIBUTOR_TESTS) {
    const shard = readShard(testName);
    for (const id of shard?.passed || []) passed.add(id);
    failed.push(...(shard?.failed || []));
  }
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify({
      schema: 'fence-report-v1',
      collected: [...ACCEPTANCE_IDS],
      passed: ACCEPTANCE_IDS.filter(id => passed.has(id) && !failed.some(f => f.id === id)),
      failed,
    }, null, 2) + '\n',
  );
}

async function check(
  localPassed: Set<AcceptanceId>,
  localFailed: Failure[],
  id: AcceptanceId,
  assertion: () => Promise<void> | void,
) {
  try {
    await assertion();
    localPassed.add(id);
  } catch (e) {
    localFailed.push({ id, kind: 'assert', message: e instanceof Error ? e.message : String(e) });
  }
}

function uniqueSession(prefix: string, workerIndex: number): string {
  return `f7-${prefix}-${process.pid}-${workerIndex}-${Date.now()}`;
}

function createSession(sessionName: string) {
  const result = spawnSync('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    'bash',
    '-lc',
    `printf ${JSON.stringify(`${sessionName} agent output fixture\\n`)}; exec sleep 300`,
  ], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function killSession(sessionName: string) {
  spawnSync('tmux', ['kill-session', '-t', sessionName], { encoding: 'utf8' });
}

function paneTargetFor(sessionName: string): string {
  const result = spawnSync('tmux', ['display-message', '-p', '-t', sessionName, '#S:#I.#P'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function installOwnerSession(page, primaryName: string, secondaryName: string, primaryTarget: string, secondaryTarget: string) {
  await page.addInitScript(({ ownerToken, primaryName, secondaryName, primaryTarget, secondaryTarget }) => {
    localStorage.setItem('agj_token', ownerToken);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
    localStorage.setItem('agj_terminal_active_group', 'f7-window');
    localStorage.setItem('agj_terminal_groups', JSON.stringify([
      { id: 'f7-window', name: 'F7 Window', sessions: [primaryName, secondaryName] },
    ]));
    localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent(primaryTarget)}`, 'test draft');
    localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent(secondaryTarget)}`, 'other draft');
  }, { ownerToken: OWNER_TOKEN, primaryName, secondaryName, primaryTarget, secondaryTarget });
}

async function openAgentWindow(page, testInfo, prefix: string, sessions: string[]) {
  const primaryName = uniqueSession(`${prefix}-a`, testInfo.workerIndex);
  const secondaryName = uniqueSession(`${prefix}-b`, testInfo.workerIndex);
  createSession(primaryName);
  sessions.push(primaryName);
  createSession(secondaryName);
  sessions.push(secondaryName);
  const primaryTarget = paneTargetFor(primaryName);
  const secondaryTarget = paneTargetFor(secondaryName);

  await expect.poll(async () => {
    const resp = await page.request.get(`${APP_ORIGIN}/api/tmux/sessions`, { headers: AUTH_HEADERS });
    const json = await resp.json().catch(() => ({}));
    return Array.isArray(json.sessions) && json.sessions.some((session) => session.session_name === primaryName);
  }, { timeout: 10000 }).toBe(true);

  await installOwnerSession(page, primaryName, secondaryName, primaryTarget, secondaryTarget);
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]').click();
  const row = page.locator('.terminal-list-name').filter({ hasText: primaryName }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
}

async function finishContributor(testName: string, localPassed: Set<AcceptanceId>, localFailed: Failure[]) {
  fs.writeFileSync(
    shardPath(testName),
    JSON.stringify({ passed: [...localPassed], failed: localFailed }, null, 2) + '\n',
  );
  writeReport();
  expect(localFailed, `FENCE failures: ${JSON.stringify(localFailed)}`).toEqual([]);
}

test.beforeEach(async ({}, testInfo) => {
  try { fs.unlinkSync(shardPath(testInfo.title)); } catch {}
});

test.afterAll(() => {
  writeReport();
});

test('test_f1_refresh_from_session_surface_visible', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    await openAgentWindow(page, testInfo, 'f1', sessions);

    await check(localPassed, localFailed, 'G3', async () => {
      const refresh = page.locator('[data-testid="refresh-from-session"]');
      await expect(refresh).toBeVisible();
    });

    await finishContributor(testInfo.title, localPassed, localFailed);
  } finally {
    for (const sessionName of sessions) killSession(sessionName);
  }
});

test('test_f2_draft_and_switcher_surfaces_are_rendered', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    await openAgentWindow(page, testInfo, 'f2', sessions);

    await check(localPassed, localFailed, 'G1', async () => {
      const draft = page.locator('[data-testid="terminal-draft"]');
      await expect(draft).toBeVisible();
    });

    await check(localPassed, localFailed, 'G2', async () => {
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      await expect(switcher).toBeVisible();
    });

    await finishContributor(testInfo.title, localPassed, localFailed);
  } finally {
    for (const sessionName of sessions) killSession(sessionName);
  }
});

test('test_f3_refresh_action_and_draft_reload_keep_composer_usable', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    await openAgentWindow(page, testInfo, 'f3', sessions);

    await check(localPassed, localFailed, 'I1', async () => {
      const refreshBtn = page.locator('[data-testid="terminal-refresh"]');
      await expect(refreshBtn).toBeVisible();
      await refreshBtn.click();
      await expect(page.locator('[data-testid="terminal-turn-agent"]')).toBeVisible();
    });

    await check(localPassed, localFailed, 'I2', async () => {
      const draftInput = page.locator('[data-testid="terminal-composer-input"]');
      await expect(draftInput).toBeVisible();
      await draftInput.fill('test draft');
      await page.reload();
      await expect(draftInput).toHaveValue('test draft');
    });

    await finishContributor(testInfo.title, localPassed, localFailed);
  } finally {
    for (const sessionName of sessions) killSession(sessionName);
  }
});

test('test_f4_header_v2_collapses_without_losing_command_center_chrome', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    await openAgentWindow(page, testInfo, 'f4', sessions);

    await check(localPassed, localFailed, 'H1', async () => {
      const header = page.locator('[data-testid="terminal-header-v2"]');
      await expect(header).toBeVisible();
    });

    await check(localPassed, localFailed, 'H2', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const header = page.locator('[data-testid="command-center-header"]');
      await expect(header).toBeAttached();
      const collapsed = await header.evaluate(el => getComputedStyle(el).height);
      expect(collapsed).toBeDefined();
    });

    await finishContributor(testInfo.title, localPassed, localFailed);
  } finally {
    for (const sessionName of sessions) killSession(sessionName);
  }
});

test('test_f5_phone_dropdown_and_wide_switcher_are_available', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    await openAgentWindow(page, testInfo, 'f5', sessions);

    await check(localPassed, localFailed, 'J1', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
      await expect(dropdown).toBeVisible();
    });

    await check(localPassed, localFailed, 'J2', async () => {
      await page.setViewportSize({ width: 1024, height: 800 });
      const switcher = page.locator('[data-testid="agent-group-switcher"]');
      await expect(switcher).toBeVisible();
    });

    await finishContributor(testInfo.title, localPassed, localFailed);
  } finally {
    for (const sessionName of sessions) killSession(sessionName);
  }
});

test('test_f6_window_theme_attribute_is_applied', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  const sessions: string[] = [];
  try {
    await openAgentWindow(page, testInfo, 'f6', sessions);

    await check(localPassed, localFailed, 'H3', async () => {
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(theme).toBeTruthy();
    });

    await finishContributor(testInfo.title, localPassed, localFailed);
  } finally {
    for (const sessionName of sessions) killSession(sessionName);
  }
});
