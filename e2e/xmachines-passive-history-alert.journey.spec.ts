import { test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardedCheck } from './xmachines-fence-helpers.mjs';

// ---------------------------------------------------------------------------
// Fence E3 — INTEGRATION: a browser-free fake-fleet sampling cycle persists
// trends, drives cadence-aware sparklines, and sends ONE deduped production
// Telegram update captured at the owner destination with zero wakes.
// Contributors: B12 (delivery) and D6 (history render + cadence).
//
// THIS JOURNEY IS AUTHORED RED ON PURPOSE. It defines what would prove E3 and
// implements none of it; it contains no product code. It is red today because
// B12 and D6 have not landed:
//   * B12 — nothing in dist/services/xmachines exports an alert-delivery
//     entry point, so no outbound Telegram update can be captured at all
//     (tests/unit/xmachines-alert-delivery-capture.spec.ts does not exist).
//   * D6 — `src/web/public/app.js` contains zero occurrences of "xmachines",
//     so there is no section, no sparkline and no foreground refresh cadence
//     to observe (e2e/xmachines-history-cadence.spec.ts does not exist).
//
// ONE SEPARATELY-NAMED TEST PER CONTRIBUTOR, so a red CLOSE can name WHICH
// contributor broke composition in `failing_units`. A single test asserting
// all fourteen ids is unattributable — the validator would have to answer
// fault_class=plan failing_units=(none) and the fence could never requeue.
//   test_d6_...   F1a F1b F1c F2a F2b F2c F4a F4b F4c  (unit D6)
//   test_b12_...  F3b F3c I1d I1e L9d                  (unit B12)
//
// Attribution of the ids whose ORIGINATING slice is not an E3 contributor
// (req-matrix.md): F2a/F2b/F2c are the persisted history D6 renders — if the
// series is absent the sparkline cannot exist, so they sit with D6. F3b/F3c
// and L9d are asserted over the ALERT cycle, which is the cycle B12 owns: the
// realistic B12 regression is probing or waking a box to enrich an alert
// message before sending it, and that is exactly what the spy refuses.
// Only TWO distinct units appear across every rejection, so a red report
// stays `missing_acceptance` and never trips the J1c >2-unit plan_defect rule.
//
// AMBIGUITIES RECORDED (authored to the reading below; nothing was left out):
//  1. No canonical DOM contract for D6 exists yet, so F4a/F4b/F4c accept any of
//     `xmachines-sparkline-<metric>`, `xmachines-<metric>-sparkline` or
//     `[data-metric="<metric>"] svg`, and F1a accepts `xmachines-sample-age` or
//     `xmachines-updated-age`. That broadens WHERE the evidence may appear; it
//     does not weaken WHAT must be true (a plotted series of >=2 points, and an
//     age string that changed after a real refetch).
//  2. B12's delivery signature is unchosen, so the alert child DISCOVERS the
//     entry point (any exported delivery-verb function about alerts under
//     src/services/xmachines) and tries the plausible call shapes. The capture
//     server, never the child's own report, decides whether an update went out.
//  3. F1b's hidden tab is simulated by overriding document.hidden /
//     visibilityState before load, which drives the real visibilitychange
//     handler; Playwright cannot background a tab for real.
//  4. FENCE_ORIGIN defaults to the app's canonical :3101. A pm2 process running
//     a build older than the xmachines routes answers 404 there — still a real
//     response and a real assertion failure, but restart the app before reading
//     a CLOSE verdict off this journey.
// ---------------------------------------------------------------------------

const FENCE_ID = 'E3';
const ACCEPTANCE_IDS = [
  'F1a', 'F1b', 'F1c', 'F2a', 'F2b', 'F2c', 'F3b', 'F3c',
  'F4a', 'F4b', 'F4c', 'I1d', 'I1e', 'L9d',
];
// id -> the contributor blamed when it rejects. Exactly two distinct units.
const COVERED: Record<string, string> = {
  F1a: 'D6', F1b: 'D6', F1c: 'D6',
  F2a: 'D6', F2b: 'D6', F2c: 'D6',
  F4a: 'D6', F4b: 'D6', F4c: 'D6',
  F3b: 'B12', F3c: 'B12', L9d: 'B12',
  I1d: 'B12', I1e: 'B12',
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The app's canonical local port. The xmachines routes hard-refuse any other
// Host (`host_not_allowed`), so a fence pointed elsewhere could never observe
// a read route at all. FENCE_ORIGIN overrides for a deployed target.
const ORIGIN = (process.env.FENCE_ORIGIN || 'http://127.0.0.1:3101').replace(/\/$/, '');

// One observation window, long enough that a 30s foreground cadence must fire
// inside it at least once and a 30m passive cadence cannot.
const CADENCE_WINDOW_MS = Number(process.env.FENCE_CADENCE_WINDOW_MS || 35_000);
const READ_ROUTE = /\/api\/xmachines\//;

// A DOWN box that must stay DOWN, and an UP box that may be read.
const DOWN_FAKE = 'e3-down-fake';
const UP_FAKE = 'e3-up-fake';
const WAKE_VERBS = ['up', 'run', 'claim', 'release', 'wake'];

function finish(fenceTest: string, results: boolean[], expected: number): void {
  if (results.length !== expected) {
    throw new Error(`${fenceTest}: expected ${expected} acceptance checks, ran ${results.length}`);
  }
  if (results.some((ok) => !ok)) {
    throw new Error(`${fenceTest}: one or more acceptance ids failed — see the [FENCE-REJECT-V1] lines above`);
  }
}

// ---------------------------------------------------------------------------
// Owner session. The read routes and the history routes are owner-gated, so a
// journey without a session would observe 401 everywhere and could never go
// green once D6 lands. Minted against the app's own database exactly as the
// command-center fence runner does, and removed again in afterAll — deleting
// it mid-run would break auth and fake a failure.
// ---------------------------------------------------------------------------
let ownerToken = process.env.OWNER_TOKEN || '';
let mintedSession: { dbPath: string; sessionId: string } | null = null;
let mintNote = '';

test.beforeAll(async () => {
  if (ownerToken) return;
  try {
    const dotenv = await import('dotenv');
    dotenv.default.config({ path: path.join(REPO_ROOT, '.env') });
    const jwt = (await import('jsonwebtoken')).default;
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.resolve(REPO_ROOT, process.env.DB_PATH || 'data/agjassist.db');
    const db = new Database(dbPath);
    const owner = db
      .prepare("SELECT id, telegram_id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1")
      .get() as { id: number; telegram_id: number } | undefined;
    const userId = owner?.id ?? 1;
    const telegramId = owner?.telegram_id ?? 0;
    const sessionId = `e3-fence-${Date.now()}`;
    const secret = process.env.JWT_SECRET || 'agjassist-dev-secret-change-me';
    const token = jwt.sign({ sub: userId, sid: sessionId, tid: telegramId }, secret, { expiresIn: '1h' });
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, surface, expires_at) VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId, userId, crypto.createHash('sha256').update(token).digest('hex'), 'web',
      new Date(Date.now() + 3600_000).toISOString());
    db.close();
    ownerToken = token;
    mintedSession = { dbPath, sessionId };
  } catch (error) {
    // Soft-fail on purpose: a throw here would abort collection and the driver
    // would see an env error instead of a proving assertion failure.
    mintNote = `owner session could not be minted (${(error as Error).message})`;
  }
});

test.afterAll(async () => {
  if (!mintedSession) return;
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(mintedSession.dbPath);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(mintedSession.sessionId);
    db.close();
  } catch { /* the session expires in an hour regardless */ }
});

function authNote(): string {
  return mintNote ? ` [${mintNote}]` : '';
}

// ---------------------------------------------------------------------------
// The browser-free cycle. A child node process runs the REAL sampler out of
// dist/ against a fake fleet with a PATH gateway-spy installed, into a scratch
// database, and reports what it persisted. No browser is attached to that
// process — that is the whole point of F2a.
// ---------------------------------------------------------------------------
function installSpies(bin: string, log: string): void {
  // The command name is a literal baked into the spy script, not read from
  // argv[0] at invocation time, so the row's executable identity cannot be
  // spoofed by how the child happened to be invoked (the A14/A15 pattern).
  for (const name of ['ping', 'ssh', 'xmac.sh', 'wakeonlan', 'nvidia-smi', 'smartctl', 'upsc']) {
    const body = `#!/bin/bash\nset -u\n{\n  printf '%s' ${JSON.stringify(name)}\n  for arg in "$@"; do printf '\\t%s' "$arg"; done\n  printf '\\n'\n} >> ${JSON.stringify(log)}\nexit 0\n`;
    const file = path.join(bin, name);
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
}

function argvRows(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
}

function isForbiddenGatewayCall(row: string[]): boolean {
  if (row[0] === 'xmac.sh' || row[0] === 'wakeonlan') return true;
  return row.some((token) => WAKE_VERBS.includes(token));
}

type Scratch = { dir: string; bin: string; log: string; dbPath: string; fleet: string; env: NodeJS.ProcessEnv };

function newScratch(prefix: string): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'argv.log');
  installSpies(bin, log);
  const fleet = path.join(dir, 'observed-fleet.json');
  fs.writeFileSync(fleet, JSON.stringify([
    { name: DOWN_FAKE, state: 'down' },
    { name: UP_FAKE, state: 'up' },
  ]));
  const dbPath = path.join(dir, 'e3.db');
  return {
    dir,
    bin,
    log,
    dbPath,
    fleet,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      XMACHINES_ARM: '0',
      XMACHINES_OBSERVED_FLEET: fleet,
      DB_PATH: dbPath,
      E3_UP_FAKE: UP_FAKE,
    },
  };
}

function runChild(scratch: Scratch, source: string, name: string): { report: any; stderr: string; status: number } {
  // The children run the REAL modules through tsx against src/, so the fence
  // never depends on dist/ being freshly built (a stale bundle would make the
  // journey red for a build reason instead of a capability reason). The .mts
  // extension forces ESM for a file that lives outside the package root.
  const script = path.join(scratch.dir, `${name}.mts`);
  const out = path.join(scratch.dir, `${name}.json`);
  fs.writeFileSync(script, source.replace('__OUT__', JSON.stringify(out)).replace(/__SRC__/g, path.join(REPO_ROOT, 'src')));
  const result = spawnSync('npx', ['tsx', script], {
    cwd: REPO_ROOT,
    env: scratch.env,
    encoding: 'utf8',
    timeout: 90_000,
  });
  let report: any = null;
  if (fs.existsSync(out)) {
    try { report = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { report = null; }
  }
  return { report, stderr: `${result.stderr || ''}`.slice(-600), status: result.status ?? 1 };
}

// Two consecutive sampler cycles into a scratch DB, with no browser attached.
const CYCLE_CHILD = `
import fs from 'node:fs';
const out = __OUT__;
const report = { ok: false, rows: [] };
try {
  const { DatabaseService } = await import('__SRC__/db/database.js');
  const { resolveXmachinesRuntime } = await import('__SRC__/services/xmachines/runtime.js');
  const { sampleFleet } = await import('__SRC__/services/xmachines/sampler.js');
  const db = new DatabaseService(process.env.DB_PATH);
  const runtime = resolveXmachinesRuntime(process.env);
  runtime.telemetry.useReaderStore(db.raw);
  report.armed = runtime.armed;
  const count = () => db.raw.prepare('SELECT COUNT(*) AS n FROM xm_samples').get().n;

  // Fake fleet + SYNTHETIC telemetry (the L9(i) fence class). Each cycle
  // carries different values so the persisted series has distinct points for a
  // sparkline to plot rather than one flat repeated reading.
  for (const [i, reading] of [[0, 61], [1, 68], [2, 74]]) {
    runtime.telemetry.installGpuReadings([{
      machineName: process.env.E3_UP_FAKE,
      gpuUuid: 'GPU-UUID-E3-FENCE',
      temperature: reading,
      powerWatts: 120 + i * 25,
      utilizationGpu: 10 + i * 20,
    }]);
    sampleFleet(process.env, runtime);
    report.rows.push(count());
  }
  const fleet = runtime.telemetry.generate();
  report.machines = fleet.map((row) => row.name);
  report.states = Object.fromEntries(fleet.map((row) => [row.name, String(row.state)]));
  report.series = db.raw
    .prepare('SELECT temperature, power_watts, utilization_gpu FROM xm_samples ORDER BY id')
    .all();
  report.ok = true;
} catch (error) {
  report.error = String(error && error.stack ? error.stack : error).slice(0, 600);
}
fs.writeFileSync(out, JSON.stringify(report));
`;

// The alert cycle: collect, evaluate twice with the SAME breach, and deliver
// through whatever alert-delivery entry point B12 lands. The delivery target
// is discovered by scanning dist/services/xmachines for an exported function
// whose name says it delivers alerts, so the journey does not depend on a
// module name that has not been chosen yet — it depends on the capability.
const DELIVER_CHILD = `
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const out = __OUT__;
const dir = path.join('__SRC__', 'services', 'xmachines');
const report = { ok: false, discovered: null, attempts: [], due: [] };
try {
  const { DatabaseService } = await import('__SRC__/db/database.js');
  const { resolveXmachinesRuntime } = await import('__SRC__/services/xmachines/runtime.js');
  const { sampleFleet } = await import('__SRC__/services/xmachines/sampler.js');
  const { AlertEvaluator } = await import('__SRC__/services/xmachines/alert-evaluator.js');
  const db = new DatabaseService(process.env.DB_PATH);
  const runtime = resolveXmachinesRuntime(process.env);
  runtime.telemetry.useReaderStore(db.raw);
  report.armed = runtime.armed;
  runtime.telemetry.installGpuReadings([{
    machineName: process.env.E3_UP_FAKE,
    gpuUuid: 'GPU-UUID-E3-FENCE',
    temperature: 95,
    powerWatts: 240,
    utilizationGpu: 99,
  }]);
  sampleFleet(process.env, runtime);
  report.states = Object.fromEntries(runtime.telemetry.generate().map((r) => [r.name, String(r.state)]));

  // The SAME critical thermal breach evaluated four times. Two-sample
  // persistence makes it due on the second cycle; the 30-minute re-notify
  // window must suppress it on the third and fourth.
  const evaluator = new AlertEvaluator();
  const breach = () => [{ machine: process.env.E3_UP_FAKE, t1: 95, t2: 95, cpu: 40, fan: 1200 }];
  const alerts = [];
  for (let i = 0; i < 4; i++) {
    const due = evaluator.evaluateSamples(breach());
    report.due.push(due.length);
    alerts.push(...due);
  }
  report.alerts = alerts;

  // B12's entry point is discovered, not guessed by module name: any exported
  // function in src/services/xmachines whose name says it delivers alerts.
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
  report.scanned = files.length;
  let target = null;
  for (const file of files) {
    let mod;
    try { mod = await import(path.join(dir, file)); } catch { continue; }
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function') continue;
      const deliveryVerb = /^(deliver|send|notify|dispatch|flush)/i.test(name);
      const aboutAlerts = /alert/i.test(name) || /alert-(delivery|deliver|sender|send|notify)/i.test(file);
      if (deliveryVerb && aboutAlerts) { target = { file, name, fn: value }; break; }
    }
    if (target) break;
  }
  if (!target) {
    report.error = 'no exported alert-delivery function found in src/services/xmachines (scanned ' + files.length + ' modules)';
  } else {
    report.discovered = target.file + '#' + target.name;
    // The signature is B12's to choose; try the plausible shapes. The capture
    // server, not this report, decides whether an update actually went out.
    const forms = [
      () => target.fn(alerts),
      () => target.fn({ alerts, db: db.raw }),
      () => target.fn(alerts, { db: db.raw }),
      () => target.fn(db.raw, alerts),
      () => target.fn(),
    ];
    for (const form of forms) {
      try { await form(); report.attempts.push('ok'); break; }
      catch (error) { report.attempts.push(String(error && error.message ? error.message : error).slice(0, 160)); }
    }
  }
  report.ok = Boolean(target);
} catch (error) {
  report.error = String(error && error.stack ? error.stack : error).slice(0, 600);
}
// Spy self-test, AFTER the cycle: proves the PATH spy is installed and
// recording, so "zero wake calls" is a real observation and not an artefact of
// a spy that was never reached. 'ping' is a read verb, never a wake verb.
try { spawnSync('ping', ['e3-spy-selftest'], { encoding: 'utf8' }); report.selftest = true; }
catch (error) { report.selftest = false; }
fs.writeFileSync(out, JSON.stringify(report));
`;

// ---------------------------------------------------------------------------
// A local capture server standing in for api.telegram.org. It records the
// ACTUAL outbound Telegram updates, which is the only thing that proves I1d;
// a mocked dialog inside the sender is explicitly not acceptable.
// ---------------------------------------------------------------------------
type Captured = { url: string; body: any };

async function withCaptureServer<T>(fn: (base: string, captured: Captured[]) => Promise<T>): Promise<T> {
  const captured: Captured[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      let body: any = null;
      const raw = Buffer.concat(chunks).toString('utf8');
      try { body = JSON.parse(raw); } catch { body = raw; }
      captured.push({ url: req.url || '', body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: captured.length } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`, captured);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function sendMessageCaptures(captured: Captured[]): Captured[] {
  return captured.filter((entry) => /\/bot[^/]*\/sendMessage$/.test(entry.url));
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
// D6 — persisted history rendered as sparklines, refreshed at 30s only while
// the xmachines view is active and visible.
// Owns: F1a F1b F1c F2a F2b F2c F4a F4b F4c
// ---------------------------------------------------------------------------
test('test_d6_persisted_history_renders_sparklines_and_only_a_visible_xmachines_view_refetches', async ({ browser }) => {
  test.setTimeout(CADENCE_WINDOW_MS + 75_000);
  const results: boolean[] = [];
  const scratch = newScratch('e3-history-');

  try {
    // ---- the browser-free sampling cycle that produces the series ----------
    const cycle = runChild(scratch, CYCLE_CHILD, 'cycle.mjs');

    // F2a — the server sampler runs with no browser session present.
    results.push(await guardedCheck('F2a', COVERED.F2a, async () => {
      if (!cycle.report?.ok) {
        throw new Error(`browser-free sampler cycle did not complete: ${cycle.report?.error || cycle.stderr || `exit ${cycle.status}`}`);
      }
      const firstCycleRows = cycle.report.rows?.[0] ?? 0;
      if (!(firstCycleRows > 0)) {
        throw new Error(`sampler persisted no rows with no browser attached (rows after cycle 1 = ${firstCycleRows})`);
      }
      if (!cycle.report.machines?.includes(UP_FAKE)) {
        throw new Error(`fake fleet not sampled: machines=${JSON.stringify(cycle.report.machines)}`);
      }
    }));

    // F2b — the server sampler schedules on a 30-minute cadence.
    results.push(await guardedCheck('F2b', COVERED.F2b, async () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'src/index.ts'), 'utf8');
      const scheduled = /setInterval\([\s\S]{0,400}?sampleFleet[\s\S]{0,400}?\}\s*,\s*(?:XmachinesSampleIntervalMs|30\s*\*\s*60\s*\*\s*1000|1800000|1_800_000)\s*\)/.test(src);
      const thirtyMinutes = /XmachinesSampleIntervalMs\s*=\s*(?:30\s*\*\s*60\s*\*\s*1000|1800000|1_800_000)/.test(src);
      if (!(scheduled && thirtyMinutes)) {
        throw new Error(`no 30-minute sampleFleet schedule found in src/index.ts (scheduled=${scheduled} thirtyMinutes=${thirtyMinutes})`);
      }
    }));

    // F2c — a sampler cycle persists metric history (it accumulates).
    results.push(await guardedCheck('F2c', COVERED.F2c, async () => {
      const rows: number[] = cycle.report?.rows ?? [];
      if (!(rows.length === 3 && rows[2] > rows[1] && rows[1] > rows[0])) {
        throw new Error(`history did not accumulate across cycles: rowCounts=${JSON.stringify(rows)}${cycle.report?.error ? ` error=${cycle.report.error}` : ''}`);
      }
      // Persisting the same reading three times is not a trend. The series a
      // sparkline can plot needs at least two DISTINCT values per metric.
      const series: Array<{ temperature: number; power_watts: number; utilization_gpu: number }> = cycle.report?.series ?? [];
      for (const column of ['temperature', 'power_watts', 'utilization_gpu'] as const) {
        const distinct = new Set(series.map((row) => row[column]));
        if (distinct.size < 2) {
          throw new Error(`persisted ${column} history holds ${distinct.size} distinct value(s), so it is not a trend: ${JSON.stringify(series).slice(0, 200)}`);
        }
      }
    }));

    // ---- the rendered side ------------------------------------------------
    // Three observations of ONE window, run together: visible, hidden tab and
    // off-route. A request counter at the browser boundary decides all three,
    // so a client clock that never refetches cannot pass F1a and a component
    // that polls regardless cannot pass F1b or F1c.
    async function openView(opts: { hidden?: boolean; offRoute?: boolean }) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const reads: string[] = [];
      page.on('request', (req) => { if (READ_ROUTE.test(req.url())) reads.push(req.url()); });
      await page.route(/telegram-web-app\.js/, (route) => route.abort());
      if (ownerToken) {
        await page.addInitScript((token) => {
          try { localStorage.setItem('agj_token', token as string); } catch { /* ignore */ }
        }, ownerToken);
      }
      if (opts.hidden) {
        await page.addInitScript(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      }
      await page.goto(`${ORIGIN}/index.html#/xmachines`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2_000);
      if (opts.offRoute) {
        await page.goto(`${ORIGIN}/index.html#/tasks`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1_000);
      }
      return { context, page, reads, mark: reads.length };
    }

    const visible = await openView({});
    const hidden = await openView({ hidden: true });
    const offRoute = await openView({ offRoute: true });

    // The sample age as first rendered, to be compared after the window.
    const AGE = '[data-testid="xmachines-sample-age"], [data-testid="xmachines-updated-age"], .xmachines-sample-age';
    const ageBefore = await visible.page.locator(AGE).first().textContent({ timeout: 2_000 }).catch(() => null);

    await visible.page.waitForTimeout(CADENCE_WINDOW_MS);

    const visibleReads = visible.reads.length - visible.mark;
    const hiddenReads = hidden.reads.length - hidden.mark;
    const offRouteReads = offRoute.reads.length - offRoute.mark;
    const ageAfter = await visible.page.locator(AGE).first().textContent({ timeout: 2_000 }).catch(() => null);

    try {
      // F1a — while active and visible, the displayed sample age advances
      // through a refresh at about 30 seconds.
      results.push(await guardedCheck('F1a', COVERED.F1a, async () => {
        if (visibleReads < 1) {
          throw new Error(`no xmachines read-route refetch in ${CADENCE_WINDOW_MS}ms while visible (requests=${visibleReads}); a client clock alone does not satisfy F1a${authNote()}`);
        }
        if (!ageBefore || !ageAfter || ageBefore === ageAfter) {
          throw new Error(`displayed sample age did not advance: before=${JSON.stringify(ageBefore)} after=${JSON.stringify(ageAfter)}${authNote()}`);
        }
      }));

      // F1b — while the tab is hidden, no foreground refresh occurs before the
      // 30-minute cadence. Vacuity guard: the visible arm must have refetched,
      // otherwise "zero while hidden" proves nothing.
      results.push(await guardedCheck('F1b', COVERED.F1b, async () => {
        if (visibleReads < 1) {
          throw new Error(`hidden-tab suppression is unobservable because the visible arm never refetched either (visible=${visibleReads} hidden=${hiddenReads})${authNote()}`);
        }
        if (hiddenReads !== 0) {
          throw new Error(`hidden tab issued ${hiddenReads} foreground read-route requests inside ${CADENCE_WINDOW_MS}ms`);
        }
      }));

      // F1c — while another app route is active, no foreground refresh occurs
      // before the 30-minute cadence. Same vacuity guard.
      results.push(await guardedCheck('F1c', COVERED.F1c, async () => {
        if (visibleReads < 1) {
          throw new Error(`off-route suppression is unobservable because the visible arm never refetched either (visible=${visibleReads} offRoute=${offRouteReads})${authNote()}`);
        }
        if (offRouteReads !== 0) {
          throw new Error(`a backgrounded route issued ${offRouteReads} foreground read-route requests inside ${CADENCE_WINDOW_MS}ms`);
        }
      }));

      // F4a/F4b/F4c — per-metric history renders as a sparkline. A sparkline
      // that rendered from a series carries at least two plotted points; an
      // empty box or a placeholder is not a sparkline.
      async function sparkline(metric: string, aliases: string[]): Promise<void> {
        const selector = aliases
          .flatMap((alias) => [
            `[data-testid="xmachines-sparkline-${alias}"]`,
            `[data-testid="xmachines-${alias}-sparkline"]`,
            `[data-metric="${alias}"] svg`,
          ])
          .join(', ');
        const node = visible.page.locator(selector).first();
        if ((await node.count()) === 0) {
          throw new Error(`no ${metric} sparkline found on the xmachines view (tried ${selector})${authNote()}`);
        }
        const geometry = await node.evaluate((el) => {
          const shape = el.matches('path, polyline') ? el : el.querySelector('path, polyline');
          if (!shape) return '';
          return shape.getAttribute('d') || shape.getAttribute('points') || '';
        });
        const points = String(geometry).match(/-?\d+(?:\.\d+)?[ ,]+-?\d+(?:\.\d+)?/g) || [];
        if (points.length < 2) {
          throw new Error(`${metric} sparkline plots ${points.length} point(s) (geometry=${JSON.stringify(String(geometry).slice(0, 120))}); a series needs at least 2`);
        }
      }

      results.push(await guardedCheck('F4a', COVERED.F4a, () => sparkline('temperature', ['temp', 'temperature'])));
      results.push(await guardedCheck('F4b', COVERED.F4b, () => sparkline('power', ['power', 'watts'])));
      results.push(await guardedCheck('F4c', COVERED.F4c, () => sparkline('utilisation', ['util', 'utilisation', 'utilization'])));
    } finally {
      await visible.context.close();
      await hidden.context.close();
      await offRoute.context.close();
    }
  } finally {
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E3/D6', results, 9);
});

// ---------------------------------------------------------------------------
// B12 — one due alert delivered through the production Telegram sender to the
// owner destination, captured locally, deduped, and with zero wakes anywhere
// in the cycle that produced it.
// Owns: F3b F3c I1d I1e L9d
// ---------------------------------------------------------------------------
test('test_b12_one_deduped_alert_reaches_the_owner_telegram_destination_with_zero_wakes', async () => {
  test.setTimeout(120_000);
  const results: boolean[] = [];
  const scratch = newScratch('e3-alert-');

  try {
    const { report, stderr, status, captured } = await withCaptureServer(async (base, captured) => {
      scratch.env = {
        ...scratch.env,
        // Every alias a production sender might read for its API base. The
        // capture server is the destination; api.telegram.org is not reachable
        // from the fence and must not be.
        TELEGRAM_API_BASE: base,
        TELEGRAM_API_BASE_URL: base,
        TELEGRAM_API_ROOT: base,
        XMACHINES_TELEGRAM_API_BASE: base,
      };
      const child = runChild(scratch, DELIVER_CHILD, 'deliver.mjs');
      // Give an in-flight outbound request time to land before teardown.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return { ...child, captured };
    });

    const rows = argvRows(scratch.log);
    const spyLive = rows.some((row) => row[0] === 'ping' && row.includes('e3-spy-selftest'));
    const forbidden = rows.filter((row) => isForbiddenGatewayCall(row) && !row.includes('e3-spy-selftest'));
    const sends = sendMessageCaptures(captured);

    // F3b — a full collection cycle emits zero wake, run, claim or release calls.
    results.push(await guardedCheck('F3b', COVERED.F3b, async () => {
      if (!spyLive) {
        throw new Error(`the gateway spy recorded no self-test row, so "zero wake calls" would be vacuous — the spy was never reached (rows=${rows.length}, ${report?.error || stderr || `exit ${status}`})`);
      }
      if (forbidden.length > 0) {
        throw new Error(`alert cycle issued ${forbidden.length} forbidden gateway call(s): ${JSON.stringify(forbidden.slice(0, 3))}`);
      }
    }));

    // F3c — a DOWN fake-fleet machine remains DOWN across a full cycle.
    results.push(await guardedCheck('F3c', COVERED.F3c, async () => {
      const state = report?.states?.[DOWN_FAKE];
      if (state !== 'down') {
        throw new Error(`${DOWN_FAKE} reported state=${JSON.stringify(state)} after the alert cycle, expected down (${report?.error || stderr || `exit ${status}`})`);
      }
    }));

    // L9d — this fake-fleet fence asserts zero wake calls, against a spy that
    // demonstrably ran, on a non-actuating gateway. Not an argv-`down` claim.
    results.push(await guardedCheck('L9d', COVERED.L9d, async () => {
      if (report?.armed === true) {
        throw new Error('the cycle ran ARMED; a fake-fleet fence must run against the non-actuating gateway');
      }
      if (!spyLive) {
        throw new Error(`no spy self-test row recorded: the zero-wake assertion has nothing to be true about (rows=${rows.length})`);
      }
      if (forbidden.length !== 0) {
        throw new Error(`zero-wake assertion fails: ${JSON.stringify(forbidden.slice(0, 3))}`);
      }
    }));

    // I1d — each due alert is delivered to the existing owner Telegram
    // destination. Proven by the capture server receiving the real outbound
    // update, never by a mocked dialog inside the sender.
    results.push(await guardedCheck('I1d', COVERED.I1d, async () => {
      if (!report?.discovered) {
        throw new Error(`no alert delivery path exists: ${report?.error || stderr || `child exit ${status}`}`);
      }
      if (sends.length === 0) {
        throw new Error(`the capture server received no Telegram sendMessage update from ${report.discovered} (attempts=${JSON.stringify(report.attempts)})`);
      }
      const destination = sends[0].body?.chat_id;
      if (destination === undefined || destination === null || String(destination).length === 0) {
        throw new Error(`captured update carries no owner destination: ${JSON.stringify(sends[0].body).slice(0, 200)}`);
      }
      const text = String(sends[0].body?.text ?? '');
      if (!text.toLowerCase().includes(UP_FAKE.toLowerCase())) {
        throw new Error(`captured update does not name the alerting machine ${UP_FAKE}: ${JSON.stringify(text.slice(0, 200))}`);
      }
    }));

    // I1e — an identical alert is suppressed until the 30-minute re-notify
    // window expires: two identical due evaluations, ONE captured update.
    results.push(await guardedCheck('I1e', COVERED.I1e, async () => {
      if (!report?.discovered) {
        throw new Error(`dedupe is unobservable because no alert delivery path exists: ${report?.error || stderr || `child exit ${status}`}`);
      }
      const due: number[] = report.due ?? [];
      if (due.length !== 4 || due.reduce((a, b) => a + b, 0) !== 1) {
        throw new Error(`the evaluator did not make the identical breach due exactly once across four cycles inside the window (due=${JSON.stringify(due)})`);
      }
      if (sends.length !== 1) {
        throw new Error(`expected exactly 1 captured Telegram update for two identical due alerts, captured ${sends.length}`);
      }
    }));
  } finally {
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  finish('E3/B12', results, 5);
});
