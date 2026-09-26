import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E1 — INTEGRATION: owner navigation reaches a dynamic fake-fleet
// overview and renders every configured machine, its state, offline treatment,
// telemetry and uptime with zero wakes.
// Contributors: D1 (navigation + routing) and D2 (overview cards rendered from
// the production read route).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E1 and
// implements none of it; it contains no product code.
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting all
// ten ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_d1_...   A1e                                       (unit D1)
//   test_d2_...   B1a B1b B1c B1d B1e B1f L9a L9d L12b       (unit D2)
//
// Attribution of the ids whose ORIGINATING slice is not an E1 contributor
// (req-matrix.md): B1a–B1f originate on B1/B4/C1 (registry + read route) and
// L12b on B1, but on THIS fence they are asserted through the rendered
// overview, which is D2's deliverable — a card that does not show the fixture's
// machines, max GPU temperature, summed measured watts, uptime or `offline`
// is a D2 regression even when the route payload is correct. L9a/L9d are the
// fake-fleet fence class asserted over the same render: the realistic D2
// regression is an overview that probes or wakes a box to fill a card, and
// that is exactly what the PATH gateway-spy refuses. Only TWO distinct units
// appear across every rejection, so a red report stays `missing_acceptance`
// and never trips the J1c >2-unit plan_defect rule.
//
// THE FAKE FLEET IS THIS JOURNEY'S OWN SERVER, NOT THE DEPLOYED APP. The
// journey spawns the real `createApiServer` in a child process with an xmac
// `status` fixture, a machines.conf fixture and a telemetry fixture, a PATH
// gateway-spy, and XMACHINES_ARM unset (the non-actuating FakeGateway, L10).
// The real fleet is never contacted and nothing can actuate. FENCE_ORIGIN is
// deliberately ignored here: a fence that read a deployed origin could not
// control which machines the fleet contains, so L12b (a fifth machine appears
// with no code change) would be unobservable.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. The xmachines routes hard-refuse any Host outside ALLOWED_HOSTS, and the
//     scratch server necessarily listens on an ephemeral port. The journey puts
//     a tunnel-shaped reverse proxy in front of it that sets
//     x-forwarded-host: agjasst.silverjrom.app + x-forwarded-proto: https —
//     exactly the header shape Cloudflare delivers in production, which is what
//     the route's hostFromRequest() reads first. That makes the browser's
//     requests LOOK like production requests; it does not relax any check.
//  2. No canonical DOM contract for a D2 card exists yet, so a "card" is any of
//     `[data-testid="xmachines-fleet-card"]`,
//     `[data-testid^="xmachines-machine-card"]` or a list item inside
//     `[data-testid="xmachines-fleet-overview"]`, and the section marker for
//     A1e is any of `[data-section="xmachines"]`,
//     `[data-testid="xmachines-fleet-overview"]` or `.xmachines-view`. That
//     broadens WHERE the evidence may appear; it does not weaken WHAT must be
//     true (the exact fixture-derived literals, per named machine).
//  3. The owner session is a stub authService inside the scratch server (the
//     C1 read-route suite's pattern). A1e/B1* are render assertions, not the
//     auth matrix — A2c owns auth and is asserted elsewhere — so minting a real
//     JWT against the production database would add a live-DB dependency
//     without adding evidence.
//  4. A1e is asserted on the Telegram mini-app shell (seeded Telegram.WebApp),
//     because that shell is the one carrying the KNOWN_EXACT landing-redirect
//     that A1d/A1e exist to defeat; the desktop shell has no such redirect and
//     would make the id vacuous.
//  5. A1e is read as this FENCE ROW reads it — "owner NAVIGATION reaches" the
//     overview, D1 being named the route-to-overview boundary — so the D1 test
//     asserts BOTH halves of that boundary: an owner starting on the landing
//     page can reach the section through a navigation affordance (the mini-app
//     home-grid tile or the desktop Header entry; either surface satisfies it,
//     the journey does not prescribe which), and a fresh #/xmachines deep link
//     renders the section rather than the landing page. A deep link alone would
//     leave the row's "navigation reaches" clause unasserted: the routing it
//     needs already landed with an earlier slice, so a deep-link-only A1e is
//     green today and could never name D1.
//  6. BASELINE NOTE, recorded rather than engineered away: every D2 id on this
//     row (B1a-B1f, L9a, L9d, L12b) is ALREADY GREEN against the landed C1
//     read route plus renderFleetOverview — measured, not assumed, by running
//     this journey. D2 will not turn any of them from red to green. They are
//     asserted here at full strength anyway, because this fence is where they
//     must keep being true once D2 re-renders the overview as cards, and the
//     contract's negative control (FENCE_STUB=D2 --expect-red B1a) still
//     discriminates D2 through them.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E1';
const ACCEPTANCE_IDS = [
  'A1e', 'B1a', 'B1b', 'B1c', 'B1d', 'B1e', 'B1f', 'L9a', 'L9d', 'L12b',
];
// id -> the contributor blamed when it rejects. Exactly two distinct units.
const COVERED: Record<string, string> = {
  A1e: 'D1',
  B1a: 'D2', B1b: 'D2', B1c: 'D2', B1d: 'D2', B1e: 'D2', B1f: 'D2',
  L9a: 'D2', L9d: 'D2', L12b: 'D2',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_TOKEN = 'e1-fence-owner-token';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const WAKE_VERBS = ['up', 'run', 'claim', 'release', 'wake'];
const SELFTEST_MARKER = 'e1-spy-selftest';

// The fake fleet. Names are deliberately unlike the real registry (gpu, gpu2,
// hdd, media, signal, glimmer) so no assertion here can accidentally be
// satisfied by, or aimed at, a real box.
const QUARTZ = 'e1-quartz';   // UP, two GPUs
const BASALT = 'e1-basalt';   // UP, one GPU
const SLATE = 'e1-slate';     // DOWN
const ONYX = 'e1-onyx';       // DOWN
const CINDER = 'e1-cinder';   // the fifth machine, added mid-run (L12b)

// Fixture-derived expectations. maxGpuTemp is the MAX of the configured temps
// (L13's aggregate rule) and powerWatts the SUM of the measured watts, so a
// card that printed the first reading, or the average, fails.
const EXPECTED = {
  [QUARTZ]: { temp: '73°C', watts: '187 W', uptime: '9d 4h 12m', notTemp: '61' },
  [BASALT]: { temp: '55°C', watts: '96 W', uptime: '3d 1h 5m', notTemp: '' },
  [CINDER]: { temp: '47°C', watts: '31 W', uptime: '0d 0h 22m', notTemp: '' },
};

const CARD_SEL = [
  '[data-testid="xmachines-fleet-card"]',
  '[data-testid^="xmachines-machine-card"]',
  '[data-testid="xmachines-fleet-overview"] li',
  '.xm-fleet li',
].join(', ');
const SECTION_SEL = [
  '[data-section="xmachines"]',
  '[data-testid="xmachines-fleet-overview"]',
  '.xmachines-view',
].join(', ');

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// Scratch fake fleet: xmac `status` text, machines.conf, telemetry fixture and
// a PATH gateway-spy. Every path here is under os.tmpdir(); the repository and
// the real ~/.config/agent-protocols/xmac are untouched.
// ---------------------------------------------------------------------------
type Scratch = {
  dir: string;
  bin: string;
  log: string;
  statusPath: string;
  confPath: string;
  metricsPath: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
};

// The command name is a literal baked into each spy script, not read from
// argv[0] at invocation time, so the recorded executable identity cannot be
// spoofed by how the child happened to be invoked (the A14/A15 pattern).
function installSpies(bin: string, log: string): void {
  for (const name of ['ping', 'ssh', 'xmac.sh', 'xmac', 'wakeonlan', 'nvidia-smi', 'smartctl', 'upsc', 'sensors']) {
    const body = `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\nexit 0\n`;
    const file = path.join(bin, name);
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
}

function statusLines(withFifth: boolean): string {
  const rows = [
    `${QUARTZ}  192.0.2.40  UP  leases=(hold-e1-ember)  compute`,
    `${BASALT}  192.0.2.41  UP  leases=()  media`,
    `${SLATE}  192.0.2.42  DOWN  leases=()  storage`,
    `${ONYX}  192.0.2.43  DOWN  leases=()  spare`,
  ];
  if (withFifth) rows.push(`${CINDER}  192.0.2.44  UP  leases=()  compute`);
  return `${rows.join('\n')}\n`;
}

function confLines(withFifth: boolean): string {
  const rows = [
    `${QUARTZ}|192.0.2.40|02:00:00:00:00:40|agjrom|compute|printf 'encoder pid 4242'`,
    `${BASALT}|192.0.2.41|02:00:00:00:00:41|agjrom|media|true`,
    `${SLATE}|192.0.2.42|02:00:00:00:00:42|agjrom|storage|true`,
    `${ONYX}|192.0.2.43|02:00:00:00:00:43|agjrom|spare|true`,
  ];
  if (withFifth) rows.push(`${CINDER}|192.0.2.44|02:00:00:00:00:44|agjrom|compute|true`);
  return `${rows.join('\n')}\n`;
}

function newScratch(): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-fleet-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log);

  const statusPath = path.join(dir, 'status.txt');
  const confPath = path.join(dir, 'machines.conf');
  const metricsPath = path.join(dir, 'metrics.json');
  const stateDir = path.join(dir, 'xmac-state');
  fs.writeFileSync(statusPath, statusLines(false));
  fs.writeFileSync(confPath, confLines(false));
  fs.mkdirSync(path.join(stateDir, 'leases', QUARTZ), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'leases', QUARTZ, 'hold-e1-ember'), '');
  // The fifth machine's metrics are present from the start: L12b is about a
  // machine appearing because the REGISTRY changed, not because a metric did.
  fs.writeFileSync(metricsPath, JSON.stringify({
    [QUARTZ]: {
      gpuTempsC: [61, 73], gpuPowerWatts: [120, 67], uptime: '9d 4h 12m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '41s', cpuTemp: 48,
    },
    [BASALT]: {
      gpuTempsC: [55], gpuPowerWatts: [96], uptime: '3d 1h 5m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '18s', cpuTemp: 44,
    },
    [SLATE]: {
      gpuTempsC: [61, 73], gpuPowerWatts: [120, 67], uptime: '9d 4h 12m',
      freshness: 'stale', sampleAge: '900s',
    },
    [ONYX]: {
      gpuTempsC: [70], gpuPowerWatts: [150], uptime: '1d 2h 3m',
      freshness: 'stale', sampleAge: '1200s',
    },
    [CINDER]: {
      gpuTempsC: [47], gpuPowerWatts: [31], uptime: '0d 0h 22m',
      freshness: 'fresh', provenance: 'collector-cli', sampleAge: '12s', cpuTemp: 39,
    },
  }));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    XMACHINES_STATUS_FIXTURE: statusPath,
    XMACHINES_TELEMETRY_FIXTURE: metricsPath,
    XMAC_CONF: confPath,
    XMAC_STATE: stateDir,
    E1_OWNER_TOKEN: OWNER_TOKEN,
  };
  // Non-actuating by default (L10): arming is process configuration, and this
  // fence must never be able to reach a real box.
  delete env.XMACHINES_ARM;
  delete env.XMACHINES_OBSERVED_FLEET;
  delete env.XMAC_LOG;
  delete env.XMACHINES_PROTECTED_FIXTURE_DIR;
  delete env.XMACHINES_USE_REGISTRY;
  return { dir, bin, log, statusPath, confPath, metricsPath, stateDir, env };
}

function argvRows(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => line.split('\t'));
}

function isForbiddenGatewayCall(row: string[]): boolean {
  if (row[0] === 'xmac.sh' || row[0] === 'xmac' || row[0] === 'wakeonlan') return true;
  return row.some((token) => WAKE_VERBS.includes(token));
}

// ---------------------------------------------------------------------------
// The scratch app server: the REAL createApiServer, run through tsx against
// src/ so the journey never depends on a freshly built dist/ (a stale bundle
// would make this red for a build reason instead of a capability reason).
// ---------------------------------------------------------------------------
const SERVER_CHILD = `
import { spawnSync } from 'node:child_process';
const { createApiServer } = await import('__SRC__/api/server.js');
const { DatabaseService } = await import('__SRC__/db/database.js');

const OWNER_TOKEN = process.env.E1_OWNER_TOKEN;
const config = {
  telegram: { botToken: '123:ABC', authorizedUserId: 1, authorizedChatIds: [1], testMode: true, updateMode: 'polling', webhookUrl: null, webhookPath: '/api/telegram/webhook', webhookSecretToken: 's' },
  runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
  api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
  db: { path: ':memory:' },
  projects: { root: '/tmp' },
  tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
  overmind: { token: 't' },
};
const services = {
  authService: {
    verifyToken: (token) => (token === OWNER_TOKEN ? { id: 1, role: 'owner', username: 'owner' } : null),
    is2FAEnabled: () => false,
  },
  projectService: {}, safetyService: {}, auditService: {}, tmuxService: {}, tmuxStreamManager: {},
  db: new DatabaseService(':memory:'),
  delegationService: {}, noteService: {}, planService: {}, taskService: {}, fileService: {},
  stepTemplateService: {}, personalTaskService: {}, reminderService: {}, agentAssignmentService: {},
};
const app = await createApiServer(config, services);
await app.listen({ port: 0, host: '127.0.0.1' });
// Spy self-test BEFORE anything is served, so "zero wake calls" is a real
// observation and not an artefact of a spy that was never on PATH. 'ping' is a
// read verb, never a wake verb.
spawnSync('ping', ['__SELFTEST__'], { encoding: 'utf8' });
console.log('E1-SERVER-READY ' + app.server.address().port);
`;

type Server = { child: ChildProcessWithoutNullStreams; port: number; stderr: () => string };

async function startServer(scratch: Scratch): Promise<Server> {
  const script = path.join(scratch.dir, 'server.mts');
  fs.writeFileSync(
    script,
    SERVER_CHILD.replace(/__SRC__/g, path.join(REPO_ROOT, 'src')).replace('__SELFTEST__', SELFTEST_MARKER),
  );
  const child = spawn('npx', ['tsx', script], {
    cwd: REPO_ROOT,
    env: scratch.env,
    encoding: 'utf8',
  } as never) as ChildProcessWithoutNullStreams;
  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = out.match(/E1-SERVER-READY (\d+)/);
    if (match) return { child, port: Number(match[1]), stderr: () => err.slice(-800) };
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`scratch app server never became ready (exit=${child.exitCode}) ${err.slice(-600)}`);
}

// A tunnel-shaped reverse proxy. Production reaches these routes through
// Cloudflare, which delivers Host: localhost:3101 and the real public name in
// x-forwarded-host; the route's hostFromRequest() reads the forwarded header
// first. This reproduces that header shape for a server on an ephemeral port.
// It relaxes no check: the route still applies its own allowlist.
async function startProxy(targetPort: number): Promise<{ base: string; close: () => Promise<void> }> {
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
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------
// The owner's browser: the Telegram mini-app shell at phone width, carrying an
// owner session, loading #/xmachines as a FRESH page load (A1e is about a deep
// link surviving the landing redirect, not about an in-app click).
// ---------------------------------------------------------------------------
type Card = {
  text: string;
  aria: string;
  temp: string | null;
  watts: string | null;
  uptime: string | null;
  state: string | null;
  alerts: number;
};

type Opened = {
  close: () => Promise<void>;
  cards: Card[];
  hash: string;
  sectionCount: number;
  bodyText: string;
  payloads: Array<{ armed?: boolean; mode?: string; machines?: Array<Record<string, unknown>> }>;
  statuses: number[];
};

type Shell = 'miniapp' | 'desktop';

// One authenticated owner browser on the app the scratch server serves. `shell`
// picks which app shell app.js mounts: 'miniapp' seeds Telegram.WebApp.initData
// (TgApp), 'desktop' leaves it unset (App).
async function openShell(
  browser: import('@playwright/test').Browser,
  base: string,
  opts: { hash: string; shell?: Shell },
): Promise<{
  context: import('@playwright/test').BrowserContext;
  page: import('@playwright/test').Page;
  payloads: Opened['payloads'];
  statuses: number[];
}> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const payloads: Opened['payloads'] = [];
  const statuses: number[] = [];
  page.on('response', async (response) => {
    if (!/\/api\/xmachines\/telemetry/.test(response.url())) return;
    statuses.push(response.status());
    try { payloads.push(await response.json()); } catch { /* non-JSON body */ }
  });
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(([token, shell]) => {
    if (shell === 'miniapp') {
      const w = window as unknown as { Telegram?: unknown };
      w.Telegram = {
        WebApp: {
          initData: 'e1-fence',
          ready() {}, expand() {}, disableVerticalSwipes() {},
          themeParams: {},
          BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
          HapticFeedback: { selectionChanged() {} },
        },
      };
    }
    try {
      localStorage.setItem('agj_token', token as string);
      localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'owner', username: 'owner', role: 'owner' }));
    } catch { /* ignore */ }
  }, [OWNER_TOKEN, opts.shell ?? 'miniapp'] as [string, string]);

  await page.goto(`${base}/index.html${opts.hash}`, { waitUntil: 'domcontentloaded' });
  return { context, page, payloads, statuses };
}

async function snapshot(
  page: import('@playwright/test').Page,
  payloads: Opened['payloads'],
  statuses: number[],
  close: () => Promise<void>,
): Promise<Opened> {
  const cards: Card[] = await page.$$eval(CARD_SEL, (nodes) => nodes.map((el) => {
    const pick = (selector: string): string | null => {
      const found = el.querySelector(selector);
      return found ? (found.textContent || '').trim() : null;
    };
    return {
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      aria: el.getAttribute('aria-label') || '',
      temp: pick('[data-testid="xmachines-gpu-temp"]'),
      watts: pick('[data-testid="xmachines-power-draw"]'),
      uptime: pick('[data-testid="xmachines-uptime"]'),
      state: pick('[data-testid="xmachines-power-state"], [data-testid="xmachines-state"]'),
      alerts: el.querySelectorAll('[role="alert"]').length,
    };
  }));
  const hash = await page.evaluate(() => location.hash);
  const sectionCount = await page.locator(SECTION_SEL).count();
  const bodyText = ((await page.locator('body').textContent()) || '').replace(/\s+/g, ' ').trim();

  return { close, cards, hash, sectionCount, bodyText, payloads, statuses };
}

// The overview as an owner deep-linking straight to it sees it.
async function openOverview(browser: import('@playwright/test').Browser, base: string): Promise<Opened> {
  const { context, page, payloads, statuses } = await openShell(browser, base, { hash: '#/xmachines' });
  // Give the section its own chance to appear; a miss here is an assertion
  // failure below, not a thrown timeout.
  await page.waitForSelector(CARD_SEL, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
  return snapshot(page, payloads, statuses, () => context.close());
}

// Owner navigation, the route-to-overview boundary this fence names: start on
// the app's landing page and reach the section by USING the app, not by typing
// a hash. Either shell's affordance satisfies it — the mini-app home-grid tile
// or the desktop Header entry — so the journey reports on both and needs one.
const NAV_SEL = [
  '[data-testid="xmachines-tile"]',
  '[data-testid="xmachines-nav"]',
  '[data-nav="xmachines"]',
  'a[href="#/xmachines"]',
  'a[href="/#/xmachines"]',
].join(', ');

type NavAttempt = { shell: Shell; affordances: number; hash: string; sectionCount: number; error: string };

async function navigateFromLanding(
  browser: import('@playwright/test').Browser,
  base: string,
  shell: Shell,
): Promise<NavAttempt> {
  const { context, page } = await openShell(browser, base, { hash: '#/', shell });
  try {
    await page.waitForTimeout(1_500);
    // A tile or link the owner can actually see and press. A hidden node is not
    // navigation, so visible-only.
    const visible: number[] = [];
    const count = await page.locator(NAV_SEL).count();
    for (let i = 0; i < count; i++) {
      if (await page.locator(NAV_SEL).nth(i).isVisible().catch(() => false)) visible.push(i);
    }
    if (visible.length === 0) {
      // Last resort before declaring no affordance: any visible, pressable
      // element whose own label names the section (a tile need not carry a
      // testid or an href to be the thing the owner presses).
      const labelled = page.locator('a, button, [role="button"], [role="link"], li, .tile, .card')
        .filter({ hasText: /xmachines/i });
      const labelledCount = await labelled.count();
      let pressed = false;
      for (let i = 0; i < labelledCount; i++) {
        const node = labelled.nth(i);
        if (!(await node.isVisible().catch(() => false))) continue;
        await node.click({ timeout: 3_000 }).catch(() => {});
        pressed = true;
        break;
      }
      if (!pressed) {
        return { shell, affordances: 0, hash: await page.evaluate(() => location.hash), sectionCount: 0, error: 'no visible xmachines navigation affordance on the landing page' };
      }
    } else {
      await page.locator(NAV_SEL).nth(visible[0]).click({ timeout: 5_000 }).catch(() => {});
    }
    await page.waitForSelector(SECTION_SEL, { timeout: 10_000 }).catch(() => {});
    return {
      shell,
      affordances: visible.length,
      hash: await page.evaluate(() => location.hash),
      sectionCount: await page.locator(SECTION_SEL).count(),
      error: '',
    };
  } finally {
    await context.close();
  }
}

function cardFor(cards: Card[], name: string): Card | undefined {
  return cards.filter((card) => card.text.includes(name) || card.aria.includes(name))[0];
}

function stateLabel(card: Card | undefined): string {
  if (!card) return '';
  if (card.state) return card.state.toLowerCase();
  return card.text.toLowerCase();
}

// ---------------------------------------------------------------------------
// Structural guard on the split itself: the two per-contributor tests below
// must between them cover exactly the row's acceptance ids, each once.
// ---------------------------------------------------------------------------
test('test_split_covers_every_acceptance_id_exactly_once', async () => {
  const covered = Object.keys(COVERED).sort();
  const expected = [...ACCEPTANCE_IDS].sort();
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    throw new Error(`fence ${FENCE_ID}: per-contributor tests cover ${JSON.stringify(covered)}, contract acceptance_ids are ${JSON.stringify(expected)}`);
  }
  const units = new Set(Object.values(COVERED));
  if (units.size !== 2) {
    throw new Error(`fence ${FENCE_ID}: rejections must name exactly the 2 contributors, found ${JSON.stringify([...units])}`);
  }
});

// ---------------------------------------------------------------------------
// D1 — the route-to-overview boundary: owner navigation reaches the xmachines
// section from the landing page, and a fresh `#/xmachines` deep link renders
// the section rather than the landing page (mini-app shell, the one carrying
// the KNOWN_EXACT landing redirect).
// Owns: A1e
// ---------------------------------------------------------------------------
test('test_d1_owner_navigation_and_a_fresh_deep_link_both_reach_the_xmachines_section', async ({ browser }) => {
  test.setTimeout(180_000);
  const results: boolean[] = [];
  const scratch = newScratch();
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let opened: Opened | null = null;
  let nav: NavAttempt[] = [];
  let startupError = '';

  try {
    try {
      server = await startServer(scratch);
      proxy = await startProxy(server.port);
      opened = await openOverview(browser, proxy.base);
      nav = [
        await navigateFromLanding(browser, proxy.base, 'miniapp'),
        await navigateFromLanding(browser, proxy.base, 'desktop'),
      ];
    } catch (error) {
      startupError = (error as Error).message;
    }

    // A1e — the section is REACHED (owner navigation from the landing page, on
    // either shell) and RENDERS on a fresh deep link that was not redirected.
    results.push(await guardedCheck('A1e', COVERED.A1e, async () => {
      if (!opened) throw new Error(`the owner's browser never reached the section: ${startupError}`);
      if (opened.hash !== '#/xmachines') {
        throw new Error(`a fresh deep link was redirected away from the section: location.hash=${JSON.stringify(opened.hash)} (KNOWN_EXACT must accept /xmachines)`);
      }
      if (opened.sectionCount === 0) {
        throw new Error(`no xmachines section rendered on a fresh #/xmachines load (tried ${SECTION_SEL}); body=${JSON.stringify(opened.bodyText.slice(0, 200))}`);
      }
      if (/page not found/i.test(opened.bodyText)) {
        throw new Error(`the router rendered its not-found surface for #/xmachines: ${JSON.stringify(opened.bodyText.slice(0, 200))}`);
      }
      const reached = nav.filter((attempt) => attempt.hash === '#/xmachines' && attempt.sectionCount > 0);
      if (reached.length === 0) {
        throw new Error(`owner navigation cannot reach the section from the landing page on either shell — the deep link works but nothing in the app leads to it: ${JSON.stringify(nav)}`);
      }
    }));
  } finally {
    if (opened) await opened.close();
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E1/D1', results, 1);
});

// ---------------------------------------------------------------------------
// D2 — every configured machine rendered as a card from the production read
// route: state, offline treatment, max GPU temperature, summed measured watts,
// OS uptime, a fifth machine appearing from the registry alone, and zero wakes.
// Owns: B1a B1b B1c B1d B1e B1f L9a L9d L12b
// ---------------------------------------------------------------------------
test('test_d2_the_overview_renders_every_configured_machine_with_its_telemetry_and_zero_wakes', async ({ browser }) => {
  test.setTimeout(240_000);
  const results: boolean[] = [];
  const scratch = newScratch();
  let server: Server | null = null;
  let proxy: { base: string; close: () => Promise<void> } | null = null;
  let first: Opened | null = null;
  let second: Opened | null = null;
  let startupError = '';
  let pidBefore: number | undefined;
  let pidAfter: number | undefined;

  try {
    try {
      server = await startServer(scratch);
      pidBefore = server.child.pid;
      proxy = await startProxy(server.port);
      first = await openOverview(browser, proxy.base);

      // L12b: the registry gains a fifth machine. Nothing is rebuilt, the
      // server process is not restarted and no source file is touched — the
      // `status` fixture and machines.conf are the only things that changed.
      fs.writeFileSync(scratch.statusPath, statusLines(true));
      fs.writeFileSync(scratch.confPath, confLines(true));
      second = await openOverview(browser, proxy.base);
      pidAfter = server.child.exitCode === null ? server.child.pid : undefined;
    } catch (error) {
      startupError = (error as Error).message;
    }

    const fixtureNames = [QUARTZ, BASALT, SLATE, ONYX];
    const context = () => {
      if (startupError) return ` [startup: ${startupError}]`;
      const status = first?.statuses.length ? ` [telemetry HTTP ${first.statuses.join(',')}]` : ' [the page never called /api/xmachines/telemetry]';
      return `${status}${server ? ` [server stderr: ${server.stderr().slice(-200)}]` : ''}`;
    };

    // B1a — the overview lists every machine the xmac status command returns,
    // and only those (no synthetic default fleet leaking in).
    results.push(await guardedCheck('B1a', COVERED.B1a, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      const missing = fixtureNames.filter((name) => !cardFor(first!.cards, name));
      if (missing.length > 0) {
        throw new Error(`the overview is missing ${JSON.stringify(missing)} of the ${fixtureNames.length} machines the status fixture returns (rendered ${first!.cards.length} card(s): ${JSON.stringify(first!.cards.map((c) => c.text.slice(0, 40)))})${context()}`);
      }
      if (first.cards.length !== fixtureNames.length) {
        throw new Error(`the overview renders ${first.cards.length} cards for ${fixtureNames.length} configured machines: ${JSON.stringify(first.cards.map((c) => c.text.slice(0, 40)))}`);
      }
      for (const synthetic of ['gpu', 'gpu2', 'hdd', 'media', 'signal', 'glimmer']) {
        const leaked = first.cards.filter((card) => new RegExp(`(^|\\s)${synthetic}(\\s|$)`).test(card.text));
        if (leaked.length > 0) {
          throw new Error(`a machine outside the status fixture appeared on the overview (${synthetic}): ${JSON.stringify(leaked.map((c) => c.text.slice(0, 40)))}`);
        }
      }
    }));

    // B1b — each card renders its machine's power state.
    results.push(await guardedCheck('B1b', COVERED.B1b, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      for (const name of [QUARTZ, BASALT]) {
        const label = stateLabel(cardFor(first.cards, name));
        if (!/\bup\b/.test(label)) {
          throw new Error(`${name} is UP in the status fixture but its card shows no up state: ${JSON.stringify(label.slice(0, 120))}${context()}`);
        }
      }
      for (const name of [SLATE, ONYX]) {
        const label = stateLabel(cardFor(first.cards, name));
        if (!/offline|down/.test(label)) {
          throw new Error(`${name} is DOWN in the status fixture but its card shows no down/offline state: ${JSON.stringify(label.slice(0, 120))}`);
        }
      }
    }));

    // B1c — an UP GPU machine renders its MAXIMUM GPU temperature (73, not the
    // first reading 61 and not an average).
    results.push(await guardedCheck('B1c', COVERED.B1c, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      const card = cardFor(first.cards, QUARTZ);
      const expected = EXPECTED[QUARTZ].temp;
      if (card?.temp !== expected) {
        throw new Error(`${QUARTZ} card renders GPU temperature ${JSON.stringify(card?.temp ?? null)}, expected the maximum of [61,73] = ${expected}${context()}`);
      }
      if (card.text.includes(EXPECTED[QUARTZ].notTemp) && !card.text.includes('73')) {
        throw new Error(`${QUARTZ} card shows a non-maximum GPU temperature: ${JSON.stringify(card.text.slice(0, 120))}`);
      }
    }));

    // B1d — an UP machine renders its aggregate power draw (the SUM of the
    // measured watts, 120 + 67 = 187).
    results.push(await guardedCheck('B1d', COVERED.B1d, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      const card = cardFor(first.cards, QUARTZ);
      const expected = EXPECTED[QUARTZ].watts;
      if (card?.watts !== expected) {
        throw new Error(`${QUARTZ} card renders power draw ${JSON.stringify(card?.watts ?? null)}, expected the sum of the measured watts [120,67] = ${expected}${context()}`);
      }
    }));

    // B1e — an UP machine renders OS uptime, as the fixture's literal.
    results.push(await guardedCheck('B1e', COVERED.B1e, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      for (const name of [QUARTZ, BASALT]) {
        const card = cardFor(first.cards, name);
        const expected = EXPECTED[name].uptime;
        if (card?.uptime !== expected) {
          throw new Error(`${name} card renders uptime ${JSON.stringify(card?.uptime ?? null)}, expected the fixture literal ${JSON.stringify(expected)}${context()}`);
        }
      }
    }));

    // B1f — a DOWN machine renders `offline`, with no page error and no live
    // values invented for a box that cannot be read.
    results.push(await guardedCheck('B1f', COVERED.B1f, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      for (const name of [SLATE, ONYX]) {
        const card = cardFor(first.cards, name);
        if (!card) throw new Error(`${name} has no card at all, so it cannot render offline${context()}`);
        if (!/offline/i.test(card.text)) {
          throw new Error(`${name} is DOWN but its card does not read offline: ${JSON.stringify(card.text.slice(0, 120))}`);
        }
        if (card.alerts > 0 || /error/i.test(card.text)) {
          throw new Error(`${name}'s offline card renders an error treatment (${card.alerts} role=alert node(s)): ${JSON.stringify(card.text.slice(0, 120))}`);
        }
        if (card.temp !== null || card.watts !== null || card.uptime !== null) {
          throw new Error(`${name} is DOWN but its card still renders live values (temp=${JSON.stringify(card.temp)} watts=${JSON.stringify(card.watts)} uptime=${JSON.stringify(card.uptime)})`);
        }
      }
      if (/error|failed to load/i.test(first.bodyText) && !/offline/i.test(first.bodyText)) {
        throw new Error(`the overview page itself shows an error with DOWN machines present: ${JSON.stringify(first.bodyText.slice(0, 200))}`);
      }
    }));

    // L9a — the rendered telemetry values are the fake fleet's values: every
    // number on a card traces to the payload the page actually received, and
    // the payload is the non-actuating fake mode.
    results.push(await guardedCheck('L9a', COVERED.L9a, async () => {
      if (!first) throw new Error(`the overview never rendered: ${startupError}`);
      if (first.payloads.length === 0) {
        throw new Error(`the page received no /api/xmachines/telemetry payload, so no rendered value can be traced to the fake fleet${context()}`);
      }
      const payload = first.payloads[first.payloads.length - 1];
      if (payload.armed === true || payload.mode === 'armed') {
        throw new Error(`the read route reported an ARMED runtime (mode=${payload.mode}); a fake-fleet fence must run against the non-actuating gateway`);
      }
      const rows = payload.machines || [];
      const payloadNames = rows.map((row) => String(row.name));
      if (JSON.stringify(payloadNames) !== JSON.stringify(fixtureNames)) {
        throw new Error(`the payload fleet ${JSON.stringify(payloadNames)} is not the status fixture's ${JSON.stringify(fixtureNames)}`);
      }
      for (const name of [QUARTZ, BASALT]) {
        const row = rows.find((entry) => String(entry.name) === name) as Record<string, unknown>;
        const card = cardFor(first.cards, name);
        const expectations: Array<[string, string | null, string]> = [
          ['gpuTemp', card?.temp ?? null, `${row.gpuTemp}°C`],
          ['powerWatts', card?.watts ?? null, `${row.powerWatts} W`],
          ['uptime', card?.uptime ?? null, String(row.uptime)],
        ];
        for (const [field, rendered, fromPayload] of expectations) {
          if (rendered !== fromPayload) {
            throw new Error(`${name}: the card's ${field} ${JSON.stringify(rendered)} does not match the payload value ${JSON.stringify(fromPayload)} it must have been rendered from`);
          }
        }
      }
    }));

    // L9d — zero wake calls across the whole journey, against a spy that
    // demonstrably ran. Not an argv-`down` claim: this is the absence of any
    // xmac/wakeonlan invocation at all.
    results.push(await guardedCheck('L9d', COVERED.L9d, async () => {
      const rows = argvRows(scratch.log);
      const spyLive = rows.some((row) => row[0] === 'ping' && row.includes(SELFTEST_MARKER));
      if (!spyLive) {
        throw new Error(`the gateway spy recorded no self-test row, so "zero wake calls" would be vacuous — the spy was never reached (rows=${rows.length})${context()}`);
      }
      const forbidden = rows.filter((row) => isForbiddenGatewayCall(row) && !row.includes(SELFTEST_MARKER));
      if (forbidden.length !== 0) {
        throw new Error(`the overview issued ${forbidden.length} forbidden gateway call(s): ${JSON.stringify(forbidden.slice(0, 3))}`);
      }
      const payload = first?.payloads[first.payloads.length - 1];
      if (payload?.armed === true) {
        throw new Error('the overview was served by an ARMED runtime; a fake-fleet fence must run unarmed');
      }
    }));

    // L12b — a fifth machine added to the registry appears on the overview with
    // no code change: same running server, same bundle, only the fixture moved.
    results.push(await guardedCheck('L12b', COVERED.L12b, async () => {
      if (!second) throw new Error(`the overview never re-rendered after the fifth machine was configured: ${startupError}`);
      if (!pidBefore || !pidAfter || pidBefore !== pidAfter) {
        throw new Error(`the app server did not survive the registry change (pid ${pidBefore} -> ${pidAfter}); a fifth machine must appear without a restart or a rebuild`);
      }
      const fifth = cardFor(second.cards, CINDER);
      if (!fifth) {
        throw new Error(`${CINDER} was added to the status fixture and machines.conf but no card appeared (${second.cards.length} card(s): ${JSON.stringify(second.cards.map((c) => c.text.slice(0, 40)))})${context()}`);
      }
      if (second.cards.length !== fixtureNames.length + 1) {
        throw new Error(`the overview renders ${second.cards.length} cards after a fifth machine was configured, expected ${fixtureNames.length + 1}`);
      }
      if (!/\bup\b/.test(stateLabel(fifth))) {
        throw new Error(`${CINDER} is UP in the status fixture but its new card shows no up state: ${JSON.stringify(fifth.text.slice(0, 120))}`);
      }
      if (fifth.temp !== EXPECTED[CINDER].temp || fifth.uptime !== EXPECTED[CINDER].uptime) {
        throw new Error(`${CINDER}'s card renders temp=${JSON.stringify(fifth.temp)} uptime=${JSON.stringify(fifth.uptime)}, expected ${JSON.stringify(EXPECTED[CINDER].temp)} / ${JSON.stringify(EXPECTED[CINDER].uptime)}`);
      }
    }));
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    if (proxy) await proxy.close();
    if (server) server.child.kill('SIGTERM');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E1/D2', results, 9);
});
