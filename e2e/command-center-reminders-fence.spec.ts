import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const ACCEPTANCE_IDS = ['C1','C2','C3','C4','C5','C6'] as const;
const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';
const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
const FENCE_STUB = process.env.FENCE_STUB || '';

test('command-center reminders fence journey', async ({ page }, testInfo) => {
  const passed: string[] = [];
  const failed: {id:string; kind:'assert'}[] = [];

  const writeReport = () => {
    const verdict = failed.length === 0 ? 'PASS' : 'FAIL';
    const fault_class = failed.length === 0 ? 'none' : 'implementation';
    const verdict_line = `fence=C6 verdict=${verdict} fault_class=${fault_class}`;
    const report = {
      schema: 'fence-report-v1',
      verdict_line,
      collected: [...ACCEPTANCE_IDS],
      passed,
      failed
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  };

  const check = async (id, assertion) => {
    try {
      await assertion();
      passed.push(id);
    } catch (e) {
      failed.push({ id, kind: 'assert', message: e?.message || String(e) });
    }
  };

  const uid = `${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
  const sessA = `agent-a-${uid}`;
  const sessB = `agent-b-${uid}`;
  const sessC = `c5-session-${uid}`;
  const cleanupSessions = () => {
    spawnSync('bash', ['-c', `tmux kill-session -t ${sessA} || true`]);
    spawnSync('bash', ['-c', `tmux kill-session -t ${sessB} || true`]);
    spawnSync('bash', ['-c', `tmux kill-session -t ${sessC} || true`]);
  };
  const fireDue = (folderGroup: string) => {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/cc-fire-due.mts',
      '--user-id', '1', '--folder-group', folderGroup
    ], { env: process.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  };

  await page.addInitScript((ownerToken) => {
    localStorage.setItem('agj_token', ownerToken);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
  }, OWNER_TOKEN);

  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });

  try {
    // C1 schema is inspected directly from the runner-owned temp DB.
    await check('C1', async () => {
      expect(process.env.DB_PATH).toBeTruthy();
      const db = new Database(process.env.DB_PATH!);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: { name: string }) => row.name);
      db.close();
      expect(tables).toContain('agent_solicit_reminders');
      expect(tables).toContain('agent_solicit_recipients');
    });

    // C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array
    await check('C2', async () => {
      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
        headers: AUTH_HEADERS,
        data: {
          folder_group: 'test-group',
          cadence_minutes: 30,
          recipients: [{ agent_name: 'agent-a', include: 1 }, { agent_name: 'agent-b', include: 0 }],
          solicit_message: 'LITERAL_SOLICIT_C2'
        }
      });
      expect(resp.status()).toBe(201);
      const json = await resp.json();
      expect(json.reminder).toBeTruthy();
      expect(json.reminder.folder_group).toBe('test-group');
      expect(json.reminder.cadence_minutes).toBe(30);
    });

    // Helper to ensure group with sessions
    const ensureGroup = async (groupId, groupName, sessions) => {
      const getResp = await page.request.get(`${APP_ORIGIN}/api/terminal/groups`, { headers: AUTH_HEADERS });
      expect(getResp.status()).toBe(200);
      const data = await getResp.json();
      const groups = data.groups || [];
      const existing = groups.find(g => g.id === groupId || g.name === groupName);
      const updatedGroups = existing
        ? groups.map(g => (g.id === existing.id ? { ...g, sessions: Array.from(new Set([...(g.sessions||[]), ...sessions])) } : g))
        : [...groups, { id: groupId, name: groupName, sessions }];
      const putResp = await page.request.put(`${APP_ORIGIN}/api/terminal/groups`, {
        headers: AUTH_HEADERS,
        data: { groups: updatedGroups, activeGroup: data.activeGroup || 'all' }
      });
      expect(putResp.status()).toBe(200);
    };

    // C3 fireDue into real temp pane
    await check('C3', async () => {
      const groupId = 'c3-test-group';
      await ensureGroup(groupId, 'c3-test-group', [sessA, sessB]);
      const past = new Date(Date.now() - 60_000).toISOString();
      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
        headers: AUTH_HEADERS,
        data: {
          folder_group: groupId,
          cadence_minutes: 60,
          next_fire: past,
          solicit_message: 'LITERAL_SOLICIT_C3',
          recipients: [{ agent_name: sessA, include: 1 }, { agent_name: sessB, include: 0 }]
        }
      });
      expect(resp.status()).toBe(201);
      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessA} "sleep 300"`]);
      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessB} "sleep 300"`]);
      await page.waitForTimeout(200);
      fireDue(groupId);
      const outA = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessA}`]).stdout.toString();
      const outB = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessB}`]).stdout.toString();
      expect(outA).toContain('LITERAL_SOLICIT_C3');
      expect(outB).not.toContain('LITERAL_SOLICIT_C3');
    });

    // C4 owner-gated GET /active
    await check('C4', async () => {
      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active?c4_probe=1`, { headers: AUTH_HEADERS });
      expect(resp.status()).toBe(200);
      const json = await resp.json();
      expect(Array.isArray(json.reminders)).toBe(true);
    });

    // C5 UI sheet visible with literal data
    await check('C5', async () => {
      const respCreate = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
        headers: AUTH_HEADERS,
        data: {
          folder_group: 'c5-active-group',
          cadence_minutes: 120,
          recipients: [{ agent_name: 'agent-a', include: 1 }],
          solicit_message: 'LITERAL_ACTIVE_C5'
        }
      });
      expect(respCreate.status()).toBe(201);
      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessC} "sleep 300"`]);
      await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
      await page.locator(`select option:has-text("${sessC}")`).first().waitFor({ state: 'attached', timeout: 5000 });
      await page.evaluate((sessC) => {
        const sel = document.querySelector('select');
        if (!sel) return;
        for (const opt of Array.from(sel.options)) {
          if (opt.textContent.includes(sessC)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, sessC);
      await page.waitForTimeout(1000);
      await page.locator('.terminal-chat-detail-pill').waitFor({ state: 'attached', timeout: 5000 });
      await expect(page.locator('.terminal-chat-detail-pill')).toContainText(sessC);
      await expect(page.locator('[data-testid="terminal-menu"]')).toBeVisible();
      await page.locator('[data-testid="terminal-menu"]').click({ force: true });
      const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(1000);
      const sheetText = await sheet.innerText();
      expect(sheetText).toContain('120 min');
    });

    // C6 solicit reached only included panes with real fire
    await check('C6', async () => {
      const groupId = 'c6-test-group';
      await ensureGroup(groupId, 'c6-test-group', [sessA, sessB]);
      const past = new Date(Date.now() - 60_000).toISOString();
      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
        headers: AUTH_HEADERS,
        data: {
          folder_group: groupId,
          cadence_minutes: 60,
          next_fire: past,
          solicit_message: 'LITERAL_SOLICIT_C6',
          recipients: [{ agent_name: sessA, include: 1 }, { agent_name: sessB, include: 0 }]
        }
      });
      expect(resp.status()).toBe(201);
      const reminderId = (await resp.json()).reminder.id;
      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessA} "sleep 300"`]);
      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessB} "sleep 300"`]);
      await page.waitForTimeout(200);
      fireDue(groupId);
      const outA = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessA}`]).stdout.toString();
      const outB = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessB}`]).stdout.toString();
      expect(outA).toContain('LITERAL_SOLICIT_C6');
      expect(outB).not.toContain('LITERAL_SOLICIT_C6');
      const auditResp = await page.request.get(`${APP_ORIGIN}/api/audit?action_type=reminder_fire&agent_name=${sessA}`, { headers: AUTH_HEADERS });
      expect(auditResp.status()).toBe(200);
      const auditJson = await auditResp.json();
      const hasAudit = (auditJson.entries || []).some(e => {
        let details = e.details;
        if (typeof details === 'string') {
          try { details = JSON.parse(details); } catch {}
        }
        return details?.solicit_message === 'LITERAL_SOLICIT_C6';
      });
      expect(hasAudit).toBe(true);
      const activeResp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active?c6_probe=1`, { headers: AUTH_HEADERS });
      expect(activeResp.status()).toBe(200);
      const activeJson = await activeResp.json();
      const rem = (activeJson.reminders || []).find(r => r.id === reminderId);
      expect(rem).toBeTruthy();
      expect(rem.repeat_count).toBeGreaterThan(0);
    });

    try {
      expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
    } finally {
      cleanupSessions();
      writeReport();
    }
  } finally {
    cleanupSessions();
    writeReport();
  }
});
