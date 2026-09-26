import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// D9 focused gate. The owner session is seeded the same way as
// e2e/xmachines-navigation.spec.ts stubApp. The power attempt and the
// expected row text come from the real route and from GET /api/xmachines/audit,
// not from a stub of the view.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const OWNER = {
  token: 'd9-focused-owner',
  id: 1,
  name: 'owner',
  username: 'owner',
  role: 'owner' as const,
};
const MACHINE = 'd9-audit-specimen';
const SPECIMEN_KEY = 'd9-focused-specimen-7f3c';

const SERVER_CHILD = `
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');
const { AuditService } = await import('__SRC__/services/audit-service.js');

const TOKENS = new Map([
  [process.env.D9_OWNER_TOKEN, { id: 1, role: 'owner', username: 'owner' }],
]);

const config = {
  telegram: { botToken: '123:ABC', authorizedUserId: 1, authorizedChatIds: [1], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
  runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
  api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
  db: { path: ':memory:' },
  projects: { root: '/tmp' },
  tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
  overmind: { token: 't' },
};

const db = new DatabaseService(':memory:');
db.prepare('INSERT INTO users (id, telegram_id, username, role, active) VALUES (?, ?, ?, ?, 1)').run(1, 900091, 'owner', 'owner');

const services = {
  authService: {
    verifyToken: (token) => TOKENS.get(token) ?? null,
    is2FAEnabled: () => false,
  },
  projectService: {}, safetyService: {}, tmuxService: {}, tmuxStreamManager: {},
  auditService: new AuditService(db),
  db,
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
console.log('D9-SERVER-READY ' + app.server.address().port);
`;

type StoredDetails = {
  target?: string;
  classification?: string;
  request?: { idempotencyKey?: string };
};

let base = '';
let child: ChildProcessWithoutNullStreams | null = null;
let closeProxy: (() => Promise<void>) | null = null;
let stored: StoredDetails | null = null;

function gatewayScript(): string {
  return `#!/bin/bash
set -u
exit 0
`;
}

function scratchEnv(dir: string): NodeJS.ProcessEnv {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'xmac.sh'), gatewayScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'xmac.sh'), 0o755);
  fs.writeFileSync(path.join(bin, 'ssh'), gatewayScript(), { mode: 0o755 });
  fs.chmodSync(path.join(bin, 'ssh'), 0o755);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  const protectedDir = path.join(dir, 'protected');
  const xmacLog = path.join(dir, 'xmac.log');
  fs.writeFileSync(statusPath, `${MACHINE} 192.0.2.70 DOWN leases=() compute\n`);
  fs.writeFileSync(confPath, `${MACHINE}|192.0.2.70|02:00:00:00:00:70|agjrom|compute|echo d9-fixture-busy-check\n`);
  fs.writeFileSync(metricsPath, JSON.stringify({
    [MACHINE]: { gpuTempsC: [40], gpuPowerWatts: [10], uptime: '1h', freshness: 'fresh', provenance: 'fixture', sampleAge: '10s', cpuTemp: 30 },
  }));
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(protectedDir, { recursive: true });
  fs.writeFileSync(path.join(protectedDir, 'status.json'), JSON.stringify({ [MACHINE]: { ip: '192.0.2.70' } }));
  fs.writeFileSync(path.join(protectedDir, 'roles.json'), JSON.stringify({}));
  fs.writeFileSync(path.join(protectedDir, 'leases.json'), JSON.stringify({ names: [] }));
  fs.writeFileSync(path.join(protectedDir, 'schedule.json'), JSON.stringify({}));
  const now = Date.now();
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(xmacLog, `${stamp(now - 30 * 60 * 1000)} WAKE ${MACHINE} 1\n${stamp(now - 20 * 60 * 1000)} UP ${MACHINE} 1\n`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_ARM: '1',
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMACHINES_PROTECTED_FIXTURE_DIR: protectedDir,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    XMAC_LOG: xmacLog,
    XMAC_USER: 'agjrom',
    XMACHINES_UP_SECONDS: '3600',
    D9_OWNER_TOKEN: OWNER.token,
  };
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMACHINES_USE_REGISTRY;
  delete env.XMACHINES_FORCE_PROBE_FIXTURE;
  return env;
}

async function startServer(dir: string, env: NodeJS.ProcessEnv): Promise<number> {
  const script = path.join(dir, 'server.mts');
  fs.writeFileSync(script, SERVER_CHILD.replace(/__SRC__/g, path.join(REPO_ROOT, 'src')));
  child = spawn('npx', ['tsx', script], { cwd: REPO_ROOT, env } as never) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = out.match(/D9-SERVER-READY (\d+)/);
    if (match) return Number(match[1]);
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`scratch app server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
}

async function startProxy(targetPort: number): Promise<void> {
  const server = http.createServer((req, res) => {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    headers.host = `127.0.0.1:${targetPort}`;
    headers['x-forwarded-host'] = CANONICAL_HOST;
    headers['x-forwarded-proto'] = 'https';
    if (headers.origin) headers.origin = `https://${CANONICAL_HOST}`;
    const upstream = http.request(
      { host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy error: ${error.message}`);
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  closeProxy = () => new Promise<void>((resolve) => server.close(() => resolve()));
}

function httpJson(method: 'GET' | 'POST', pathname: string): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const url = new URL(pathname, base);
  const headers: Record<string, string> = {
    authorization: `Bearer ${OWNER.token}`,
    origin: `https://${CANONICAL_HOST}`,
    'idempotency-key': SPECIMEN_KEY,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: Number(url.port), method, path: `${url.pathname}${url.search}`, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { text += chunk; });
        res.on('end', () => {
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = null; }
          resolve({ status: res.statusCode ?? 0, json: parsed, text });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd9-power-audit-'));
  const port = await startServer(dir, scratchEnv(dir));
  await startProxy(port);
  const posted = await httpJson('POST', `/api/xmachines/machines/${MACHINE}/power/on`);
  if (posted.status !== 202 && posted.status !== 400 && posted.status !== 403 && posted.status !== 404) {
    throw new Error(`power attempt returned ${posted.status}: ${posted.text.slice(0, 240)}`);
  }
  const read = await httpJson('GET', '/api/xmachines/audit?limit=200');
  if (read.status !== 200) throw new Error(`GET /api/xmachines/audit answered ${read.status}: ${read.text.slice(0, 240)}`);
  const entries = (read.json?.entries ?? []) as Array<Record<string, unknown>>;
  const match = entries.map((entry) => {
    let details: StoredDetails = {};
    try { details = JSON.parse(String(entry.details ?? '{}')) as StoredDetails; } catch { details = {}; }
    return details;
  }).find((details) => details.request?.idempotencyKey === SPECIMEN_KEY);
  if (!match) throw new Error(`audit log has no row for ${SPECIMEN_KEY}: ${read.text.slice(0, 400)}`);
  stored = match;
});

test.afterAll(async () => {
  if (closeProxy) await closeProxy();
  child?.kill('SIGTERM');
});

test('owner power audit view renders the stored attempt', async ({ page }) => {
  test.setTimeout(120_000);
  const details = stored;
  expect(details, 'GET /api/xmachines/audit produced no specimen row').not.toBeNull();
  expect(details?.request?.idempotencyKey).toBe(SPECIMEN_KEY);
  expect(details?.target).toBe(MACHINE);
  expect(details?.classification && details.classification.length > 0).toBe(true);

  await page.route(/telegram-web-app\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.addInitScript((sessionUser) => {
    localStorage.setItem('agj_token', (sessionUser as { token: string }).token);
    const { token: _token, ...user } = sessionUser as { token: string; id: number; name: string; username: string; role: string };
    localStorage.setItem('agj_user', JSON.stringify(user));
  }, { ...OWNER });

  await page.goto(`${base}/index.html#/xmachines/audit`, { waitUntil: 'domcontentloaded' });

  const view = page.locator('[data-testid="xmachines-power-audit"]');
  await expect(view).toBeVisible();
  const rows = page.locator('[data-testid="xmachines-audit-row"]');
  await expect(rows).toHaveCount(1, { timeout: 20_000 });
  const rendered = ((await rows.first().innerText()) || '').replace(/\s+/g, ' ');
  expect(rendered).toContain(details?.target);
  expect(rendered).toContain(details?.classification);
  expect(rendered).toContain(details?.request?.idempotencyKey);
});
