import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// D12 focused gate. The owner session is minted by AuthService and the
// username / 2FA flag are fixtures written on the users row. Expected UI
// text, hash '#/', empty agj_token, and HTTP 401 are literals. The shell
// cache is deliberately a different user so the card cannot pass by
// echoing localStorage.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATION_DIR = path.join(REPO_ROOT, 'xmachines/projcore-run-2026-09-25/validation');
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const FIXTURE_USERNAME = 'd12-owner-fixture';
const SHELL_USERNAME = 'shell-only';
const LOGIN_HASH = '#/';
const REVOKED_STATUS = 401;
const LIVE_STATUS = 200;

type Scratch = { dir: string; dbPath: string; env: NodeJS.ProcessEnv };
type Server = { child: ChildProcessWithoutNullStreams; port: number; token: string; stderr: () => string };

function installSpies(bin: string, log: string): void {
  fs.mkdirSync(bin, { recursive: true });
  for (const name of ['ping', 'ssh', 'xmac.sh', 'xmac', 'wakeonlan', 'nvidia-smi', 'smartctl', 'upsc', 'sensors']) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/bash\nset -u\nprintf '%s\\n' ${JSON.stringify(name)} >> ${JSON.stringify(log)}\nexit 0\n`, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd12-revoke-'));
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log);
  const dbPath = path.join(dir, 'd12.sqlite');
  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statusPath, 'd12-quartz  192.0.2.80  UP  leases=()  compute\n');
  fs.writeFileSync(confPath, 'd12-quartz|192.0.2.80|02:00:00:00:00:80|agjrom|compute|true\n');
  fs.writeFileSync(metricsPath, JSON.stringify({
    'd12-quartz': { gpuTempsC: [40], gpuPowerWatts: [10], freshness: 'fresh', provenance: 'collector-cli', sampleAge: '20s', cpuTemp: 30 },
  }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    D12_DB_PATH: dbPath,
  };
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMAC_LOG;
  delete env.XMACHINES_USE_REGISTRY;
  return { dir, dbPath, env };
}

const SERVER_CHILD = `
import { createApiServer } from '__SRC__/api/server.js';
import { DatabaseService } from '__SRC__/db/database.js';
import { AuthService } from '__SRC__/auth/auth-service.js';
import { AuditService } from '__SRC__/services/audit-service.js';

const BOT_TOKEN = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
const OWNER_TG = 7001000;
const USERNAME = ${JSON.stringify(FIXTURE_USERNAME)};
const db = new DatabaseService(process.env.D12_DB_PATH);
db.ensureOwner(OWNER_TG);
db.prepare('UPDATE users SET username = ? WHERE telegram_id = ?').run(USERNAME, OWNER_TG);
const authService = new AuthService(db, BOT_TOKEN, 'd12-secret', 1);
const auditService = new AuditService(db);
const code = authService.generateLoginCode(OWNER_TG);
const minted = authService.authenticateWithCode(code);
if (!minted || minted.user.role !== 'owner') throw new Error('could not mint owner session');
db.prepare('UPDATE users SET totp_enabled = 1 WHERE telegram_id = ?').run(OWNER_TG);
const config = {
  telegram: { botToken: BOT_TOKEN, authorizedUserId: OWNER_TG, authorizedChatIds: [OWNER_TG], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
  runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
  api: { port: 0, host: '127.0.0.1', jwtSecret: 'd12-secret', sessionExpiryHours: 1 },
  db: { path: process.env.D12_DB_PATH },
  projects: { root: '/tmp' },
  tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
  overmind: { token: 't' },
};
const services = {
  authService, auditService, db,
  projectService: {},
  safetyService: { listPatterns() { return []; } },
  tmuxService: {}, tmuxStreamManager: {},
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
console.log('D12-SERVER-READY ' + JSON.stringify({ port: app.server.address().port, token: minted.token }));
`;

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(script, SERVER_CHILD.replaceAll('__SRC__', path.join(REPO_ROOT, 'src')));
  const child = spawn('npx', ['tsx', script], { cwd: REPO_ROOT, env: scratch.env }) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = out.match(/D12-SERVER-READY (\{.*\})/);
    if (match) {
      const parsed = JSON.parse(match[1]) as { port: number; token: string };
      return { child, port: parsed.port, token: parsed.token, stderr: () => err.slice(-800) };
    }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`revoke server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
}

function probeMe(port: number, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/auth/me',
      headers: {
        host: CANONICAL_HOST,
        'x-forwarded-host': CANONICAL_HOST,
        'x-forwarded-proto': 'https',
        origin: CANONICAL_ORIGIN,
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode || 0));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startProxy(targetPort: number): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    headers.host = `127.0.0.1:${targetPort}`;
    headers['x-forwarded-host'] = CANONICAL_HOST;
    headers['x-forwarded-proto'] = 'https';
    if (headers.origin) headers.origin = CANONICAL_ORIGIN;
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
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function openSettings(browser: Browser, base: string, token: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route(/telegram-web-app\.js|cdn\.jsdelivr\.net\/npm\/xterm/, (route) => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    body: '',
  }));
  // Seed once per tab. A reload after revoke must not write the bearer back.
  await page.addInitScript(([storedToken, shellName]) => {
    if (sessionStorage.getItem('d12-session-seeded')) return;
    sessionStorage.setItem('d12-session-seeded', '1');
    localStorage.setItem('agj_token', storedToken as string);
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, username: shellName, role: 'viewer' }));
  }, [token, SHELL_USERNAME] as [string, string]);
  await page.goto(`${base}/index.html#/settings`, { waitUntil: 'domcontentloaded' });
  return { page, close: () => context.close() };
}

async function capture(page: Page, stem: string): Promise<void> {
  fs.mkdirSync(VALIDATION_DIR, { recursive: true });
  await page.screenshot({ path: path.join(VALIDATION_DIR, `${stem}.png`), fullPage: true });
  const aria = await page.locator('body').ariaSnapshot();
  fs.writeFileSync(path.join(VALIDATION_DIR, `${stem}-aria.yaml`), aria);
}

test('owner settings revoke-all-web-sessions returns to login and rejects the prior token', async ({ browser }) => {
  test.setTimeout(120_000);
  const scratch = newScratch();
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let opened: { page: Page; close: () => Promise<void> } | null = null;
  try {
    server = await startServer(scratch);
    const prior = server.token;
    expect(await probeMe(server.port, prior)).toBe(LIVE_STATUS);

    proxy = await startProxy(server.port);
    opened = await openSettings(browser, proxy.base, prior);
    const { page } = opened;
    const card = page.locator('.item-card', { hasText: 'Role:' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(FIXTURE_USERNAME);
    await expect(card).toContainText('owner');
    await expect(card).toContainText('2FA ON');
    await expect(card).not.toContainText(SHELL_USERNAME);
    await expect(card).not.toContainText('viewer');

    const button = page.locator('[data-testid="revoke-all-web-sessions"]');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('Revoke All Web Sessions');
    await capture(page, 'D12-revoke-settings-a2');

    await button.click({ noWaitAfter: true });
    await page.waitForSelector('.login-container', { timeout: 20_000 });
    expect(new URL(page.url()).hash).toBe(LOGIN_HASH);
    expect(await page.evaluate(() => localStorage.getItem('agj_token'))).toBeNull();
    await expect(page.locator('.login-container')).toBeVisible();
    await capture(page, 'D12-revoke-login-a2');

    expect(await probeMe(server.port, prior)).toBe(REVOKED_STATUS);
  } finally {
    if (opened) await opened.close();
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }
});
