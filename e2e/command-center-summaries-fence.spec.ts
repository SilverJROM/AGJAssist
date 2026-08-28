import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import http from 'node:http';
import Database from 'better-sqlite3';
import { promisify } from 'node:util';

const ACCEPTANCE_IDS = ['E1','E2','E3','F1','F2','F3'] as const;
type AcceptanceId = typeof ACCEPTANCE_IDS[number];

const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
const OWNER_TOKEN = process.env.OWNER_TOKEN || '';
const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
const FENCE_STUB = process.env.FENCE_STUB || '';
const LITERAL_SUMMARY = 'LITERAL_SUMMARY_FOR_TEST';
const execFileAsync = promisify(execFile);

const passed = new Set<AcceptanceId>();
const failed = new Map<AcceptanceId, { id: AcceptanceId; kind: 'assert'; message?: string }>();

function writeReport() {
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    schema: 'fence-report-v1',
    collected: [...ACCEPTANCE_IDS],
    passed: [...passed],
    failed: [...failed.values()]
  }, null, 2) + '\n');
}

async function check(id: AcceptanceId, assertion: () => Promise<void>) {
  try {
    await assertion();
    passed.add(id);
    failed.delete(id);
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`DIAG_${id}: ${message}`);
    failed.set(id, { id, kind: 'assert', message });
    throw new Error(`FENCE_ASSERT:${id}`);
  } finally {
    writeReport();
  }
}

function openDb(): Database.Database {
  const dbPath = process.env.DB_PATH;
  expect(dbPath, 'DB_PATH is required for the D7 fence temp-copy database').toBeTruthy();
  return new Database(dbPath!);
}

function shell(command: string) {
  return spawnSync('bash', ['-c', command], { encoding: 'utf8' });
}

async function runNode(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, args, { env: process.env });
    return { status: 0, stderr: result.stderr };
  } catch (error: any) {
    return {
      status: typeof error?.code === 'number' ? error.code : 1,
      stderr: error?.stderr || error?.message || String(error)
    };
  }
}

async function installOwner(page) {
  await page.addInitScript((token) => {
    localStorage.setItem('agj_token', token);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
  }, OWNER_TOKEN);
}

async function ensureGroup(page, groupId: string, sessions: string[]) {
  const getResp = await page.request.get(`${APP_ORIGIN}/api/terminal/groups`, { headers: AUTH_HEADERS });
  expect(getResp.status()).toBe(200);
  const data = await getResp.json();
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const existing = groups.find((g:any) => g.id === groupId || g.name === groupId);
  const updatedGroups = existing
    ? groups.map((g:any) => g.id === existing.id ? { ...g, sessions: Array.from(new Set([...(g.sessions || []), ...sessions])) } : g)
    : [...groups, { id: groupId, name: groupId, sessions }];
  const putResp = await page.request.put(`${APP_ORIGIN}/api/terminal/groups`, {
    headers: AUTH_HEADERS,
    data: { groups: updatedGroups, activeGroup: data.activeGroup || 'all' }
  });
  expect(putResp.status()).toBe(200);
}

async function openTerminalSession(page, sessionName: string) {
  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
  const sessionRow = page.locator('[data-testid="terminal-session-row"]').filter({ hasText: sessionName }).first();
  if (await sessionRow.count()) {
    await sessionRow.click();
    return;
  }
  const select = page.locator('select');
  if (await select.count()) {
    await page.locator(`select option:has-text("${sessionName}")`).first().waitFor({ state: 'attached', timeout: 5000 });
    await page.evaluate((sess) => {
      const sel = document.querySelector('select');
      if (!sel) return;
      for (const opt of Array.from(sel.options)) {
        if (opt.textContent?.includes(sess)) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, sessionName);
  }
}

async function withOpenAiFixture(summaryText: string, body: (baseUrl: string) => Promise<void>) {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', () => {
        requests.push(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: summaryText } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const addr = server.address();
    expect(addr && typeof addr !== 'string').toBeTruthy();
    await body(`http://127.0.0.1:${(addr as any).port}/v1`);
    expect(requests.join('\n')).toContain('LITERAL_AGENT_REPLY_FOR_SUMMARY');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function createSummaryThroughClosedC6Reply(page, agentName: string, summaryText = LITERAL_SUMMARY) {
  const sessionName = agentName;
  const folderGroup = `group-${agentName}`;

  const created = shell(`tmux new-session -d -s ${sessionName} bash`);
  expect(created.status, created.stderr).toBe(0);

  await ensureGroup(page, folderGroup, [sessionName]);

  const reminderResp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
    headers: AUTH_HEADERS,
    data: {
      folder_group: folderGroup,
      cadence_minutes: 60,
      next_fire: new Date(Date.now() - 60_000).toISOString(),
      solicit_message: 'LITERAL_SOLICIT_SUMMARY',
      recipients: [{ agent_name: sessionName, include: 1 }]
    }
  });
  expect(reminderResp.status()).toBe(201);

  await withOpenAiFixture(summaryText, async (baseUrl) => {
    const endpointsResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
    expect(endpointsResp.status()).toBe(200);
    const endpointsJson = await endpointsResp.json();
    const defaultEp = endpointsJson.endpoints?.find((e:any) => e.is_default);
    expect(defaultEp).toBeTruthy();

    const patchResp = await page.request.patch(`${APP_ORIGIN}/api/summary-endpoints/${defaultEp.id}`, {
      headers: AUTH_HEADERS,
      data: { base_url: baseUrl }
    });
    expect(patchResp.status()).toBe(200);

    const fireResult = await runNode([
      '--import', 'tsx', 'scripts/cc-fire-due.mts',
      '--user-id', '1',
      '--folder-group', folderGroup
    ]);
    expect(fireResult.status, fireResult.stderr).toBe(0);

    shell(`tmux send-keys -t ${sessionName} "printf 'LITERAL_AGENT_REPLY_FOR_SUMMARY\\n'" Enter`);
    await page.waitForTimeout(300);

    const captureResult = await runNode([
      '--import', 'tsx', 'scripts/cc-capture-reply.mts',
      '--agent-name', agentName,
      '--session', sessionName
    ]);
    expect(captureResult.status, captureResult.stderr).toBe(0);
  });

  for (let i = 0; i < 24; i++) {
    const sumResp = await page.request.get(`${APP_ORIGIN}/api/summary-agents/${encodeURIComponent(agentName)}/summaries`, { headers: AUTH_HEADERS });
    expect(sumResp.status()).toBe(200);
    const sumJson = await sumResp.json();
    const found = (sumJson.summaries || []).find((s:any) => s.summary_text === summaryText);
    if (found) return found;
    await page.waitForTimeout(250);
  }

  throw new Error(`summary ${summaryText} was not visible through public summaries read path`);
}

function seedSummary(agentName: string, summaryText: string, secondsAgo: number) {
  const db = openDb();
  try {
    const endpoint = db.prepare("SELECT id FROM summary_llm_endpoints WHERE is_default = 1 LIMIT 1").get() as { id: number } | undefined;
    expect(endpoint).toBeTruthy();
    db.prepare(
      `INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance, created_at, updated_at)
       VALUES (?, ?, ?, 'system', datetime('now', ?), datetime('now', ?))`
    ).run(agentName, endpoint!.id, summaryText, `-${secondsAgo} seconds`, `-${secondsAgo} seconds`);
    return endpoint!.id;
  } finally {
    db.close();
  }
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  writeReport();
});

test('test_d1_schema_persists_summary_provenance_and_default_endpoint', async ({ page }) => {
  await installOwner(page);
  await check('E3', async () => {
    const db = openDb();
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row:any) => row.name);
      expect(tables).toContain('summary_llm_endpoints');
      expect(tables).toContain('agent_summaries');

      const endpointCols = db.pragma('table_info(summary_llm_endpoints)').map((row:any) => row.name);
      expect(endpointCols).toEqual(expect.arrayContaining(['name', 'base_url', 'model', 'is_default', 'provenance', 'created_at', 'updated_at']));
      expect(endpointCols.some((name:string) => /secret|token|key/i.test(name))).toBe(false);

      const summaryCols = db.pragma('table_info(agent_summaries)').map((row:any) => row.name);
      expect(summaryCols).toEqual(expect.arrayContaining(['agent_name', 'endpoint_id', 'summary_text', 'provenance', 'created_at', 'updated_at']));

      const defaults = db.prepare("SELECT name, is_default, provenance FROM summary_llm_endpoints WHERE is_default = 1").all() as any[];
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('140');
      expect(defaults[0].provenance).toBeTruthy();
    } finally {
      db.close();
    }
  });
});

test('test_d2_service_exposes_seeded_default_140_endpoint', async ({ page }) => {
  await installOwner(page);
  await check('F2', async () => {
    if (FENCE_STUB === 'D3') {
      const db = openDb();
      try {
        const defaults = db.prepare("SELECT name, base_url, model FROM summary_llm_endpoints WHERE is_default = 1").all() as any[];
        expect(defaults).toHaveLength(1);
        expect(defaults[0].name).toBe('140');
        expect(defaults[0].base_url).toMatch(/^https?:\/\/.+\/v1\/?$/);
        expect(defaults[0].model).toBeTruthy();
      } finally {
        db.close();
      }
      return;
    }

    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
    expect(resp.status()).toBe(200);
    const json = await resp.json();
    const defaults = (json.endpoints || []).filter((e:any) => e.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('140');
    expect(defaults[0].base_url).toMatch(/^https?:\/\/.+\/v1\/?$/);
    expect(defaults[0].model).toBeTruthy();
  });
});

test('test_d3_reply_summary_captures_closed_c6_reply_and_persists_literal', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installOwner(page);
  await check('E1', async () => {
    const agentName = `d3-fence-${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
    try {
      const summary = await createSummaryThroughClosedC6Reply(page, agentName);
      expect(summary.summary_text).toBe(LITERAL_SUMMARY);
      expect(summary.provenance).toBe('system');
      expect(summary.endpoint_id).toBeTruthy();
    } finally {
      shell(`tmux kill-session -t ${agentName} || true`);
    }
  });
});

test('test_d4_routes_are_owner_gated_and_return_named_endpoints_and_newest_summaries', async ({ page }, testInfo) => {
  await installOwner(page);
  await check('F1', async () => {
    const unauthResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
    expect([401, 403]).toContain(unauthResp.status());

    if (FENCE_STUB !== 'D3') {
      const createResp = await page.request.post(`${APP_ORIGIN}/api/summary-endpoints`, {
        headers: AUTH_HEADERS,
        data: { name: `route-${Date.now()}`, base_url: 'http://127.0.0.1:43210/v1', model: 'literal-route-model' }
      });
      expect(createResp.status()).toBe(201);
      const created = (await createResp.json()).endpoint;
      expect(created.name).toMatch(/^route-/);
      expect(created.base_url).toBe('http://127.0.0.1:43210/v1');
    }

    const agentName = `d4-route-${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
    const endpointId = seedSummary(agentName, 'older route summary', 60);
    seedSummary(agentName, 'newer route summary', 1);

    const summariesResp = await page.request.get(`${APP_ORIGIN}/api/summary-agents/${encodeURIComponent(agentName)}/summaries`, { headers: AUTH_HEADERS });
    expect(summariesResp.status()).toBe(200);
    const summariesJson = await summariesResp.json();
    expect(summariesJson.summaries[0].summary_text).toBe('newer route summary');
    expect(summariesJson.summaries[1].summary_text).toBe('older route summary');
    expect(summariesJson.summaries[0].endpoint_id).toBe(endpointId);
  });
});

test('test_d5_settings_ui_manages_endpoints_and_surfaces_owner_errors', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installOwner(page);
  await check('F3', async () => {
    if (FENCE_STUB === 'D3') return;

    const sessionName = `d5-ui-${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
    try {
      expect(shell(`tmux new-session -d -s ${sessionName} bash`).status).toBe(0);
      await openTerminalSession(page, sessionName);

      await expect(page.locator('[data-testid="terminal-menu"]')).toBeVisible();
      await page.locator('[data-testid="terminal-menu"]').click({ force: true });
      const sheet = page.locator('[data-testid="summary-endpoint-sheet"]');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('140');

      await page.locator('[data-testid="endpoint-name-input"]').fill(`ui-${Date.now()}`);
      await page.locator('[data-testid="endpoint-baseurl-input"]').fill('http://user:secret@127.0.0.1:43210/v1');
      await page.locator('[data-testid="endpoint-model-input"]').fill('ui-model');
      await page.locator('[data-testid="endpoint-save"]').click();
      await expect(page.locator('[data-testid="endpoint-error"]')).toContainText(/base_url|valid|URL/i);
      await expect(page.locator('[data-testid="endpoint-error"]')).not.toContainText('secret');
      const endpointRowsText = (await page.locator('[data-testid="endpoint-row"]').allInnerTexts()).join('\n');
      expect(endpointRowsText).not.toContain('secret');
    } finally {
      shell(`tmux kill-session -t ${sessionName} || true`);
    }
  });
});

test('test_d6_summaries_dropdown_shows_newest_first_cards_with_endpoint_tags', async ({ page }, testInfo) => {
  await installOwner(page);
  await check('E2', async () => {
    const sessionName = `d6-ui-${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
    const paneTarget = `${sessionName}:0.0`;
    try {
      expect(shell(`tmux new-session -d -s ${sessionName} bash`).status).toBe(0);
      seedSummary(paneTarget, 'older ui summary', 60);
      seedSummary(paneTarget, LITERAL_SUMMARY, 1);

      await openTerminalSession(page, sessionName);

      await page.locator('[data-testid="summaries-toggle"]').click({ force: true });
      const dropdown = page.locator('[data-testid="agent-summaries-dropdown"]');
      await expect(dropdown).toBeVisible();
      await expect(dropdown).toHaveCSS('overflow', 'auto');
      const cards = page.locator('[data-testid="summary-card"]');
      await expect(cards.first()).toContainText(LITERAL_SUMMARY);
      await expect(cards.nth(1)).toContainText('older ui summary');
      await expect(cards.first()).toContainText(/via 140|id \d+/);
    } finally {
      shell(`tmux kill-session -t ${sessionName} || true`);
    }
  });
});
