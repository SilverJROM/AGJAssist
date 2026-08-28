import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const ACCEPTANCE_IDS = ['E1', 'E2', 'E3', 'E4'] as const;
type AcceptanceId = typeof ACCEPTANCE_IDS[number];
type Failure = { id: AcceptanceId; kind: 'assert'; message?: string };

const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';
const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
const FENCE_STUB = process.env.FENCE_STUB || '';

const CONTRIBUTOR_TESTS = [
  'test_e1_schema_persists_one_time_wakeup_fields',
  'test_e2_service_fires_due_wakeup_once_into_temp_pane',
  'test_e3_routes_schedule_pending_and_cancel_owner_wakeup',
  'test_e4_ui_shows_pending_indicator_in_expanded_and_collapsed_headers',
];

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
  const report = {
    schema: 'fence-report-v1',
    collected: [...ACCEPTANCE_IDS],
    passed: ACCEPTANCE_IDS.filter(id => passed.has(id) && !failed.some(f => f.id === id)),
    failed,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
}

function cleanupShards() {
  for (const testName of CONTRIBUTOR_TESTS) {
    try { fs.unlinkSync(shardPath(testName)); } catch {}
  }
}

function recordFailure(localFailed: Failure[], id: AcceptanceId, e: unknown) {
  localFailed.push({ id, kind: 'assert', message: e instanceof Error ? e.message : String(e) });
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
    recordFailure(localFailed, id, e);
  }
}

async function finishContributor(testName: string, localPassed: Set<AcceptanceId>, localFailed: Failure[]) {
  fs.writeFileSync(
    shardPath(testName),
    JSON.stringify({ passed: [...localPassed], failed: localFailed }, null, 2) + '\n',
  );
  writeReport();
  expect(localFailed, `FENCE failures: ${JSON.stringify(localFailed)}`).toEqual([]);
}

async function installOwnerSession(page) {
  await page.addInitScript((ownerToken) => {
    localStorage.setItem('agj_token', ownerToken);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
    localStorage.setItem('agj_terminal_groups', '[]');
    localStorage.setItem('agj_terminal_active_group', 'all');
  }, OWNER_TOKEN);
}

function requireDbPath(): string {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) throw new Error('DB_PATH missing');
  return dbPath;
}

function uniqueSession(prefix: string, workerIndex: number): string {
  return `${prefix}-${process.pid}-${workerIndex}-${Date.now()}`;
}

function killSession(sessionName: string) {
  spawnSync('bash', ['-c', `tmux kill-session -t ${sessionName} || true`]);
}

function createSession(sessionName: string) {
  const result = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, 'sleep 300'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function paneTargetFor(sessionName: string): string {
  const result = spawnSync('tmux', ['display-message', '-p', '-t', sessionName, '#S:#I.#P'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

async function choosePane(page, paneTarget: string) {
  await page.locator(`select option[value="${paneTarget}"]`).waitFor({ state: 'attached', timeout: 30000 });
  await page.evaluate((target) => {
    for (const select of Array.from(document.querySelectorAll('select'))) {
      const option = Array.from(select.options).find((opt) => opt.value === target);
      if (option) {
        select.value = target;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }, paneTarget);
  await expect(page.locator('.terminal-chat-detail-pill')).toContainText(paneTarget);
}

test.beforeEach(async ({}, testInfo) => {
  try { fs.unlinkSync(shardPath(testInfo.title)); } catch {}
});

test.afterAll(() => {
  try {
    writeReport();
  } finally {
    cleanupShards();
  }
});

test('test_e1_schema_persists_one_time_wakeup_fields', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  await installOwnerSession(page);
  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });

  await check(localPassed, localFailed, 'E1', async () => {
    if (FENCE_STUB === 'E1') {
      throw new Error('FENCE_STUB=E1 forces E1 failure');
    }

    const dbPath = requireDbPath();
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: { name: string }) => row.name);
    expect(tables).toContain('agent_one_time_wakeups');

    const paneTarget = `schema-${testInfo.workerIndex}-${Date.now()}`;
    const manualFireTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const action = 'LITERAL_ACTION_E1';
    const result = db.prepare(
      `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action)
       VALUES (?, ?, ?)`
    ).run(paneTarget, manualFireTime, action);
    const row = db.prepare(
      `SELECT pane_target, manual_fire_time, action, status
       FROM agent_one_time_wakeups
       WHERE id = ?`
    ).get(result.lastInsertRowid) as {
      pane_target: string;
      manual_fire_time: string;
      action: string;
      status: string;
    };
    db.close();

    expect(row.pane_target).toBe(paneTarget);
    expect(row.manual_fire_time).toBe(manualFireTime);
    expect(row.action).toBe(action);
    expect(row.status).toBe('pending');
  });

  await finishContributor(testInfo.title, localPassed, localFailed);
});

test('test_e2_service_fires_due_wakeup_once_into_temp_pane', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  await installOwnerSession(page);
  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });

  const sessionName = uniqueSession('e2-wakeup', testInfo.workerIndex);
  try {
    createSession(sessionName);
    const paneTarget = paneTargetFor(sessionName);

    await check(localPassed, localFailed, 'E2', async () => {
      if (FENCE_STUB === 'E2') {
        throw new Error('FENCE_STUB=E2 forces E2 failure');
      }

      const dbPath = requireDbPath();
      const actionToken = 'LITERAL_ACTION_E2';
      const action = `printf ${JSON.stringify(actionToken)}; printf '\\n'`;
      const past = new Date(Date.now() - 60_000).toISOString();
      const db = new Database(dbPath);
      db.prepare(
        `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
         VALUES (?, ?, ?, 'pending')`
      ).run(paneTarget, past, action);
      db.close();

      const script = `
import { AgentWakeupService } from './src/services/agent-wakeup-service.js';
import { DatabaseService } from './src/db/database.js';
import { SafetyService } from './src/services/safety-service.js';
import { TmuxService } from './src/tmux/tmux-service.js';
import { AuditService } from './src/services/audit-service.js';
const db = new DatabaseService(process.env.DB_PATH);
const safety = new SafetyService(db);
const tmux = new TmuxService();
tmux.setSafetyService(safety);
const audit = new AuditService(db);
const svc = new AgentWakeupService(db, safety, tmux, audit);
await svc.fireDue();
await svc.fireDue();
`;
      const tmpScript = path.join(process.cwd(), `.wakeup-fire-${process.pid}-${testInfo.workerIndex}.mjs`);
      fs.writeFileSync(tmpScript, script);
      try {
        const result = spawnSync(process.execPath, ['--import', 'tsx', tmpScript], { env: process.env, encoding: 'utf8' });
        expect(result.status, result.stderr || result.stdout).toBe(0);
      } finally {
        try { fs.unlinkSync(tmpScript); } catch {}
      }

      const out = spawnSync('tmux', ['capture-pane', '-p', '-t', paneTarget], { encoding: 'utf8' }).stdout;
      expect(out).toContain(actionToken);

      const db2 = new Database(dbPath);
      const row = db2.prepare(
        `SELECT id, status
         FROM agent_one_time_wakeups
         WHERE pane_target = ? AND action = ?`
      ).get(paneTarget, action) as { id: number; status: string };
      const pendingCount = db2.prepare(
        `SELECT COUNT(*) AS count
         FROM agent_one_time_wakeups
         WHERE pane_target = ? AND action = ? AND status = 'pending'`
      ).get(paneTarget, action) as { count: number };
      const auditCount = db2.prepare(
        `SELECT COUNT(*) AS count
         FROM audit_log
         WHERE action_type = 'agent_wakeup_fired'
           AND resource_type = 'agent_one_time_wakeup'
           AND resource_id = ?`
      ).get(String(row.id)) as { count: number };
      db2.close();

      expect(row.status).toBe('fired');
      expect(pendingCount.count).toBe(0);
      expect(auditCount.count).toBe(1);
      expect(countOccurrences(out, actionToken)).toBeLessThanOrEqual(2);
    });
  } finally {
    killSession(sessionName);
  }

  await finishContributor(testInfo.title, localPassed, localFailed);
});

test('test_e3_routes_schedule_pending_and_cancel_owner_wakeup', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  await installOwnerSession(page);
  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });

  const sessionName = uniqueSession('e3-wakeup', testInfo.workerIndex);
  try {
    createSession(sessionName);
    const paneTarget = paneTargetFor(sessionName);

    await check(localPassed, localFailed, 'E3', async () => {
      if (FENCE_STUB === 'E3') {
        throw new Error('FENCE_STUB=E3 forces E3 failure');
      }

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const action = 'LITERAL_ACTION_E3';
      const createResp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups`, {
        headers: AUTH_HEADERS,
        data: { pane_target: paneTarget, manual_fire_time: future, action }
      });
      expect(createResp.status()).toBe(201);
      const createJson = await createResp.json();
      expect(createJson.wakeup).toBeTruthy();
      expect(createJson.wakeup.pane_target).toBe(paneTarget);
      expect(createJson.wakeup.manual_fire_time).toBe(future);
      expect(createJson.wakeup.action).toBe(action);
      expect(createJson.wakeup.status).toBe('pending');

      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups/pending`, { headers: AUTH_HEADERS });
      expect(resp.status()).toBe(200);
      const json = await resp.json();
      expect(Array.isArray(json.wakeups)).toBe(true);
      const wakeup = json.wakeups.find((w: any) => w.pane_target === paneTarget && w.action === action);
      expect(wakeup).toBeTruthy();

      const cancelResp = await page.request.delete(`${APP_ORIGIN}/api/agent-wakeups/${wakeup.id}`, { headers: AUTH_HEADERS });
      expect(cancelResp.status()).toBe(204);

      const afterResp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups/pending`, { headers: AUTH_HEADERS });
      expect(afterResp.status()).toBe(200);
      const afterJson = await afterResp.json();
      expect((afterJson.wakeups || []).some((w: any) => w.id === wakeup.id)).toBe(false);
    });
  } finally {
    killSession(sessionName);
  }

  await finishContributor(testInfo.title, localPassed, localFailed);
});

test('test_e4_ui_shows_pending_indicator_in_expanded_and_collapsed_headers', async ({ page }, testInfo) => {
  const localPassed = new Set<AcceptanceId>();
  const localFailed: Failure[] = [];
  await installOwnerSession(page);

  const sessionName = uniqueSession('e4-wakeup', testInfo.workerIndex);
  try {
    createSession(sessionName);
    const paneTarget = paneTargetFor(sessionName);
    const dbPath = requireDbPath();
    const db = new Database(dbPath);
    const future = new Date(Date.now() + 65 * 60 * 1000).toISOString();
    const action = 'LITERAL_ACTION_E4';
    const result = db.prepare(
      `INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
       VALUES (?, ?, ?, 'pending')`
    ).run(paneTarget, future, action);
    db.close();

    await check(localPassed, localFailed, 'E4', async () => {
      if (FENCE_STUB === 'E4') {
        throw new Error('FENCE_STUB=E4 forces E4 failure');
      }

      await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
      await choosePane(page, paneTarget);

      const menuBtn = page.locator('[data-testid="terminal-menu"]');
      await menuBtn.waitFor({ state: 'attached', timeout: 30000 });
      await menuBtn.click();

      const sheet = page.locator('[data-testid="wakeup-sheet"]');
      await expect(sheet).toBeVisible();
      await expect(page.locator('[data-testid="wakeup-date-input"]')).toBeVisible();
      await expect(page.locator('[data-testid="wakeup-time-input"]')).toBeVisible();
      await expect(page.locator('[data-testid="wakeup-action-input"]')).toBeVisible();

      const collapsed = page.locator('[data-testid="wakeup-collapsed-summary"]');
      await expect(collapsed).toBeVisible();
      await expect(collapsed).toContainText('1 wakeup');
      await expect(collapsed).toContainText('in');

      const rows = page.locator('[data-testid="wakeup-pending-row"]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(paneTarget);
      await expect(rows.first()).toContainText(action);

      const expandToggle = page.locator('[data-testid="wakeup-expand-toggle"]');
      await expect(expandToggle).toHaveText('Collapse');
      await expandToggle.click();
      await expect(rows).toHaveCount(0);
      await expect(collapsed).toContainText('1 wakeup');
      await expandToggle.click();
      await expect(rows).toHaveCount(1);

      const db2 = new Database(dbPath);
      db2.prepare("UPDATE agent_one_time_wakeups SET status = 'cancelled' WHERE id = ?").run(result.lastInsertRowid);
      db2.close();
      await page.reload({ waitUntil: 'networkidle' });
      await choosePane(page, paneTarget);
      await page.locator('[data-testid="terminal-menu"]').click();
      await expect(page.locator('[data-testid="wakeup-collapsed-summary"]')).toContainText('No pending wakeups');
    });
  } finally {
    killSession(sessionName);
  }

  await finishContributor(testInfo.title, localPassed, localFailed);
});
