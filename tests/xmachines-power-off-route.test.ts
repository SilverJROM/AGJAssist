import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { chromium } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';
import { renderMachineCostDetail } from '../src/web/public/xmachines-cost-view.js';

const OWNER_TOKEN = 'c4-owner-token';
const OWNER_ID = 2;
const LOOPBACK_HOST = 'localhost:3101';
const LOOPBACK_ORIGIN = 'http://localhost:3101';
const MACHINE = 'media';
const LEASE_MACHINE = 'hdd';
const FIXTURE_IP = '192.0.2.50';
const FIXTURE_TARGET = 'agjrom@192.0.2.50';
const GPU_BUSY = 'gpu-process-busy';
const LEASE_HOLDER = 'xmac-claim-hdd-17-transcript-archive';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATION = path.join(REPO, 'xmachines/projcore-run-2026-09-25/validation');
const MUTATION_REPORT = path.join(VALIDATION, 'C4-mutation-report-a2.md');
const REFUSAL_HTML = path.join(VALIDATION, 'C4-off-refusal-a2.html');
const REFUSAL_PNG = path.join(VALIDATION, 'C4-off-refusal-a2.png');
const REFUSAL_DOM = path.join(VALIDATION, 'C4-off-refusal-dom-a2.json');
const EXACT_BUSY_REASON = `cannot confirm idle: ${GPU_BUSY}`;

type WolKind = 'verified' | 'stale' | 'never';
type Scenario = 'timeout' | 'error-empty' | 'unreachable' | 'busy' | 'idle' | 'idle-lease';

const SPY_SCRIPT = [
  '#!/usr/bin/env bash',
  'set -u',
  'log=${XMAC_C4_SPY_LOG:?XMAC_C4_SPY_LOG is required}',
  'release=${XMAC_C4_SPY_RELEASE:?XMAC_C4_SPY_RELEASE is required}',
  'caller=${XMAC_CALLER-}',
  '{',
  '  printf "%s" "$caller"',
  '  for arg in "$@"; do',
  '    printf "\\t%s" "$arg"',
  '  done',
  '  printf "\\n"',
  '} >> "$log"',
  'i=0',
  'while [ "$i" -lt 200 ]; do',
  '  if [ -f "$release" ]; then',
  '    break',
  '  fi',
  '  i=$((i+1))',
  '  sleep 0.05',
  'done',
  'printf "exited\\n" >> "$log"',
  'exit 0',
  '',
].join('\n');

const SSH_FAKE = `#!/bin/bash
set -u
log=\${C4_SSH_ARGV_LOG:?C4_SSH_ARGV_LOG is required}
{
  printf '%s' "$(date -u +%FT%TZ)"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$log"
scenario_file=\${C4_SSH_SCENARIO_FILE:?C4_SSH_SCENARIO_FILE is required}
scenario=$(tr -d '[:space:]' < "$scenario_file")
case "$scenario" in
  timeout)
    ppid=$PPID
    deadline=$((SECONDS + 30))
    while [ "$SECONDS" -lt "$deadline" ]; do
      if [ "$ppid" -eq 1 ] || ! kill -0 "$ppid" 2>/dev/null; then
        exit 0
      fi
      sleep 0.2
    done
    exit 0
    ;;
  error-empty)
    exit 1
    ;;
  unreachable)
    exit 255
    ;;
  busy)
    printf '%s\\n' '${GPU_BUSY}'
    exit 0
    ;;
  idle)
    exit 0
    ;;
  idle-lease)
    lease_dir="\${XMAC_STATE:?XMAC_STATE is required}/leases/\${C4_LEASE_MACHINE:?C4_LEASE_MACHINE is required}"
    mkdir -p "$lease_dir"
    : > "$lease_dir/${LEASE_HOLDER}"
    exit 0
    ;;
  *)
    printf 'unknown scenario\\n' >&2
    exit 99
    ;;
esac
`;

const ENV_KEYS = [
  'PATH',
  'XMAC_C4_SPY_LOG',
  'XMAC_C4_SPY_RELEASE',
  'XMACHINES_ARM',
  'XMAC_CONF',
  'XMAC_STATE',
  'XMAC_LOG',
  'XMACHINES_UP_SECONDS',
  'XMAC_USER',
  'C4_SSH_ARGV_LOG',
  'C4_SSH_SCENARIO_FILE',
  'C4_LEASE_MACHINE',
  'XMACHINES_PROTECTED_FIXTURE_DIR',
  'XMACHINES_STATUS_FIXTURE',
] as const;

function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${OWNER_TOKEN}`,
    host: LOOPBACK_HOST,
    origin: LOOPBACK_ORIGIN,
    ...extra,
  };
}

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: '123:ABC',
      authorizedUserId: OWNER_ID,
      authorizedChatIds: [OWNER_ID],
      testMode: true,
      updateMode: 'polling',
      webhookUrl: null,
      webhookPath: '/api/telegram/webhook',
      webhookSecretToken: 's',
    },
    runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
    api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function stubServices(): ApiServices {
  return {
    authService: { verifyToken: (t: string) => t === OWNER_TOKEN ? { id: OWNER_ID, role: 'owner', username: 'owner' } : null } as ApiServices['authService'],
    projectService: {} as ApiServices['projectService'],
    safetyService: {} as ApiServices['safetyService'],
    auditService: {} as ApiServices['auditService'],
    tmuxService: {} as ApiServices['tmuxService'],
    tmuxStreamManager: {} as ApiServices['tmuxStreamManager'],
    db: {} as ApiServices['db'],
    delegationService: {} as ApiServices['delegationService'],
    noteService: {} as ApiServices['noteService'],
    planService: {} as ApiServices['planService'],
    taskService: {} as ApiServices['taskService'],
    fileService: {} as ApiServices['fileService'],
    stepTemplateService: {} as ApiServices['stepTemplateService'],
    personalTaskService: {} as ApiServices['personalTaskService'],
    reminderService: {} as ApiServices['reminderService'],
    agentAssignmentService: {} as ApiServices['agentAssignmentService'],
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

interface SpyRecord { caller: string; argv: string[]; }

function spyRecords(spyLog: string): SpyRecord[] {
  if (!fs.existsSync(spyLog)) return [];
  return fs.readFileSync(spyLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && line !== 'exited')
    .map((line) => {
      const fields = line.split('\t');
      return { caller: fields[0] ?? '', argv: fields.slice(1) };
    });
}

async function waitForRecords(spyLog: string, min: number, timeoutMs = 2000): Promise<SpyRecord[]> {
  const deadline = Date.now() + timeoutMs;
  let rows = spyRecords(spyLog);
  while (rows.length < min && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = spyRecords(spyLog);
  }
  return spyRecords(spyLog);
}

function sshText(sshLog: string): string {
  if (!fs.existsSync(sshLog)) return '';
  return fs.readFileSync(sshLog, 'utf8');
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function wolLog(machine: string, kind: WolKind): string {
  const now = Date.now();
  const wake = stamp(now - 30 * 60 * 1000);
  const up = stamp(now - 20 * 60 * 1000);
  if (kind === 'never') return '';
  if (kind === 'stale') return `${wake} WAKE ${machine} 1\n`;
  return `${wake} WAKE ${machine} 1\n${up} UP ${machine} 1\n`;
}

interface BootOpts {
  machine?: string;
  wol?: WolKind;
  scenario?: Scenario;
  protectedRole?: boolean;
}

describe('xmachines power OFF route C4', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let release: string | undefined;
  let prev: Record<string, string | undefined> | undefined;

  afterEach(async () => {
    if (release) {
      try { fs.writeFileSync(release, 'go\n'); } catch { /* scratch already removed */ }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await app?.close();
    app = undefined;
    if (prev) {
      for (const key of ENV_KEYS) restoreEnv(key, prev[key]);
    }
    prev = undefined;
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
    release = undefined;
  });

  async function boot(opts: BootOpts = {}): Promise<{ spyLog: string; sshLog: string; stateDir: string; machine: string }> {
    const machine = opts.machine ?? MACHINE;
    prev = {};
    for (const key of ENV_KEYS) prev[key] = process.env[key];
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c4-power-off-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    const spy = path.join(bin, 'xmac.sh');
    fs.writeFileSync(spy, SPY_SCRIPT, { mode: 0o755 });
    const ssh = path.join(bin, 'ssh');
    fs.writeFileSync(ssh, SSH_FAKE, { mode: 0o755 });
    const spyLog = path.join(scratch, 'spy.log');
    const sshLog = path.join(scratch, 'ssh.log');
    release = path.join(scratch, 'release');
    const scenarioFile = path.join(scratch, 'scenario');
    fs.writeFileSync(scenarioFile, `${opts.scenario ?? 'idle'}\n`);
    const conf = path.join(scratch, 'machines.conf');
    const busyCheck = opts.scenario ? 'echo fixture-busy-check' : '';
    fs.writeFileSync(conf, `${machine}|${FIXTURE_IP}|02:00:00:00:00:50|agjrom|fixture|${busyCheck}\n`);
    const stateDir = path.join(scratch, 'xmac-state');
    fs.mkdirSync(stateDir, { recursive: true });
    const xmacLog = path.join(scratch, 'xmac.log');
    fs.writeFileSync(xmacLog, wolLog(machine, opts.wol ?? 'verified'));
    if (opts.protectedRole) {
      const fixture = path.join(scratch, 'protected');
      fs.mkdirSync(fixture);
      fs.writeFileSync(path.join(fixture, 'status.json'), JSON.stringify({ [machine]: { ip: '192.0.2.174' } }));
      fs.writeFileSync(path.join(fixture, 'roles.json'), JSON.stringify({ signal: 'live' }));
      fs.writeFileSync(path.join(fixture, 'leases.json'), JSON.stringify({ names: [] }));
      fs.writeFileSync(path.join(fixture, 'schedule.json'), JSON.stringify({}));
      process.env.XMACHINES_PROTECTED_FIXTURE_DIR = fixture;
    } else {
      delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    }
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_C4_SPY_LOG = spyLog;
    process.env.XMAC_C4_SPY_RELEASE = release;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_STATE = stateDir;
    process.env.XMAC_LOG = xmacLog;
    process.env.XMACHINES_UP_SECONDS = '3600';
    process.env.XMAC_USER = 'agjrom';
    process.env.C4_SSH_ARGV_LOG = sshLog;
    process.env.C4_SSH_SCENARIO_FILE = scenarioFile;
    process.env.C4_LEASE_MACHINE = machine;
    delete process.env.XMACHINES_STATUS_FIXTURE;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog, sshLog, stateDir, machine };
  }

  function postOff(machine: string, key?: string, body?: { challengeId: string; selectedNumber: number }) {
    const headers = ownerHeaders();
    if (key !== undefined) headers['idempotency-key'] = key;
    return app!.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${machine}/power/off`,
      headers,
      payload: body,
    });
  }

  async function expectNoSpawn(spyLog: string) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rows = spyRecords(spyLog);
    expect(rows).toEqual([]);
    expect(rows.some((row) => row.argv.includes('--force'))).toBe(false);
  }

  async function expectConsumed(machine: string, spyLog: string, label: string): Promise<{ refusalArgv: string[][]; rows: SpyRecord[] }> {
    const first = await postOff(machine, `c4-${label}-open`);
    expect(first.statusCode).toBe(400);
    const opened = first.json() as { status?: string; reason?: string; challengeId?: string; displayNumber?: number };
    expect(opened.status).toBe('rejected');
    expect(opened.reason).toBe('force-confirmation-required');
    expect(typeof opened.challengeId).toBe('string');
    expect((opened.challengeId ?? '').length).toBeGreaterThan(0);
    expect(typeof opened.displayNumber).toBe('number');
    await expectNoSpawn(spyLog);

    const wrongNumber = opened.displayNumber === 10 ? 11 : 10;
    const wrong = await postOff(machine, `c4-${label}-wrong`, {
      challengeId: opened.challengeId!,
      selectedNumber: wrongNumber,
    });
    expect(wrong.statusCode).toBe(400);
    const wrongBody = wrong.json() as { reason?: string; challengeId?: string };
    expect(wrongBody.reason).toBe('force-confirmation-required');
    await expectNoSpawn(spyLog);
    const refusalArgv = spyRecords(spyLog).map((row) => row.argv);

    const accepted = await postOff(machine, `c4-${label}-consume`, {
      challengeId: opened.challengeId!,
      selectedNumber: opened.displayNumber!,
    });
    expect(accepted.statusCode).toBe(202);
    expect((accepted.json() as { status?: string }).status).toBe('in-progress');
    const rows = await waitForRecords(spyLog, 1);
    expect(rows).toEqual([{ caller: `${OWNER_ID}+${OWNER_TOKEN}`, argv: ['down', machine, '--owner-off'] }]);
    expect(rows.some((row) => row.argv.includes('--force'))).toBe(false);
    return { refusalArgv, rows };
  }

  it('L15b: missing and blank idempotency keys are refused before a WoL challenge', async () => {
    const { spyLog, machine } = await boot({ wol: 'never' });
    const missing = await postOff(machine);
    const blank = await postOff(machine, '   ');
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    expect(missing.json()).not.toHaveProperty('challengeId');
    expect(missing.json()).not.toHaveProperty('displayNumber');
    expect(blank.json()).not.toHaveProperty('challengeId');
    expect(blank.json()).not.toHaveProperty('displayNumber');
    await expectNoSpawn(spyLog);
  });

  it('I5c/L2d: never-verified Off spawns nothing until the returned challenge is consumed, and never --force', async () => {
    const { spyLog, machine } = await boot({ wol: 'never' });
    const { refusalArgv, rows } = await expectConsumed(machine, spyLog, 'never');
    const consumedArgv = rows.map((row) => row.argv);
    const forceCount = [...refusalArgv, ...consumedArgv].filter((argv) => argv.includes('--force')).length;
    const report = [
      '# C4 mutation report',
      '',
      'Guard-3 specimen: never-verified WoL log. Unconfirmed Off and a wrong selected number spawn nothing.',
      'Consuming the returned challengeId with the returned displayNumber spawns owner-off.',
      'A rewrite that appends --force on that refusal or on the consumed launch fails force_argv=0.',
      '',
      `refusal_argv=${JSON.stringify(refusalArgv)}`,
      `consumed_argv=${JSON.stringify(consumedArgv)}`,
      `force_argv=${forceCount}`,
      '',
    ].join('\n');
    fs.mkdirSync(VALIDATION, { recursive: true });
    fs.writeFileSync(MUTATION_REPORT, report);
    const saved = fs.readFileSync(MUTATION_REPORT, 'utf8');
    expect(saved).toContain('refusal_argv=[]');
    expect(saved).toContain(`consumed_argv=${JSON.stringify([['down', machine, '--owner-off']])}`);
    expect(saved).toContain('force_argv=0');
    expect(saved).not.toContain('"--force"');
  });

  it('I5c: stale WoL Off spawns nothing until the returned challenge is consumed', async () => {
    const { spyLog, machine } = await boot({ wol: 'stale' });
    const { refusalArgv, rows } = await expectConsumed(machine, spyLog, 'stale');
    expect(refusalArgv).toEqual([]);
    expect(rows.some((row) => row.argv.includes('--force'))).toBe(false);
  });

  async function expectBusyRefusal(scenario: Scenario, key: string, detailLiteral: string) {
    const { spyLog, sshLog, machine } = await boot({ wol: 'verified', scenario });
    const res = await postOff(machine, key);
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; detail?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('cannot-confirm-idle');
    expect(body.detail).toContain('cannot confirm idle');
    expect(body.detail).toContain(detailLiteral);
    await expectNoSpawn(spyLog);
    expect(sshText(sshLog)).toContain(FIXTURE_TARGET);
    return body;
  }

  it('D2c/L1a/L2c: GPU-process stdout refuses Off and the gateway spy stays empty', async () => {
    await expectBusyRefusal('busy', 'c4-busy-gpu', GPU_BUSY);
  });

  it('L1b: busy-check timeout is BUSY and refuses Off', async () => {
    await expectBusyRefusal('timeout', 'c4-busy-timeout', 'cannot confirm idle');
  }, 25_000);

  it('L1c: nonzero empty busy-check output refuses Off', async () => {
    await expectBusyRefusal('error-empty', 'c4-busy-error-empty', 'ssh-error-empty');
  });

  it('L1d: unreachable SSH refuses Off', async () => {
    await expectBusyRefusal('unreachable', 'c4-busy-unreachable', 'ssh-error-empty');
  });

  it('L1e: fail-closed refusal detail contains cannot confirm idle', async () => {
    const body = await expectBusyRefusal('error-empty', 'c4-busy-phrase', 'cannot confirm idle');
    expect(body.detail).toContain('cannot confirm idle');
  });

  it('L1a idle control: a quiet preflight returns 202 and one owner-off argv', async () => {
    const { spyLog, sshLog, machine } = await boot({ wol: 'verified', scenario: 'idle' });
    const res = await postOff(machine, 'c4-idle-control');
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status?: string }).status).toBe('in-progress');
    expect(await waitForRecords(spyLog, 1)).toEqual([
      { caller: `${OWNER_ID}+${OWNER_TOKEN}`, argv: ['down', machine, '--owner-off'] },
    ]);
    expect(sshText(sshLog)).toContain(FIXTURE_TARGET);
  });

  it('D2d/L2a: clear owner Off records down --owner-off with zero --force', async () => {
    const { spyLog, machine } = await boot({ wol: 'verified' });
    const res = await postOff(machine, 'c4-clear-off');
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status?: string }).status).toBe('in-progress');
    const rows = await waitForRecords(spyLog, 1);
    expect(rows).toEqual([{ caller: `${OWNER_ID}+${OWNER_TOKEN}`, argv: ['down', machine, '--owner-off'] }]);
    expect(rows.some((row) => row.argv.includes('--force'))).toBe(false);
  });

  it('D2b/L2b: a lease created during the busy check is re-read and spawns nothing', async () => {
    const { spyLog, sshLog, stateDir, machine } = await boot({
      machine: LEASE_MACHINE,
      wol: 'verified',
      scenario: 'idle-lease',
    });
    const leaseFile = path.join(stateDir, 'leases', machine, LEASE_HOLDER);
    expect(fs.existsSync(leaseFile)).toBe(false);
    const res = await postOff(machine, 'c4-lease-race');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; detail?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('active-lease');
    expect(body.detail).toContain(LEASE_HOLDER);
    expect(fs.existsSync(leaseFile)).toBe(true);
    await expectNoSpawn(spyLog);
    expect(sshText(sshLog)).toContain(FIXTURE_TARGET);
  });

  it('D2d protected-role refusal spawns nothing', async () => {
    const { spyLog, machine } = await boot({ wol: 'verified', scenario: 'idle', protectedRole: true });
    const res = await postOff(machine, 'c4-protected-role');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; role?: string; detail?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('protected-role');
    expect(body.role).toBe('signal');
    expect(body.detail).toBe('signal');
    await expectNoSpawn(spyLog);
  });

  it('D2e: the detail surface renders the exact normal-Off refusal and the screenshot is on disk', async () => {
    const { spyLog, machine } = await boot({ wol: 'verified', scenario: 'busy' });
    const res = await postOff(machine, 'c4-ui-refusal');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; detail?: string };
    expect(body.reason).toBe('cannot-confirm-idle');
    await expectNoSpawn(spyLog);

    const markup = renderMachineCostDetail({
      machine: { name: machine, state: 'up' },
      offRefusal: body,
    });
    fs.mkdirSync(VALIDATION, { recursive: true });
    fs.writeFileSync(
      REFUSAL_HTML,
      `<!doctype html><html><head><meta charset="utf-8"><title>Normal Off refusal</title><style>body{font:16px sans-serif;background:#fff;color:#111;margin:24px}[role=alert]{color:#7a1f1f;font-weight:700}</style></head><body>${markup}</body></html>`,
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      await page.goto(pathToFileURL(REFUSAL_HTML).href);
      const detailText = (await page.getByTestId('xmachines-off-refusal').innerText()).trim();
      const reasonText = (await page.getByTestId('xmachines-off-refusal-reason').innerText()).trim();
      const detailAria = await page.getByTestId('xmachines-off-refusal').getAttribute('aria-label');
      const aria = await page.getByTestId('xmachines-off-refusal-block').ariaSnapshot();
      await page.screenshot({ path: REFUSAL_PNG, fullPage: true });
      fs.writeFileSync(REFUSAL_DOM, `${JSON.stringify({ detailText, reasonText, detailAria, aria }, null, 2)}\n`);
    } finally {
      await browser.close();
    }

    const saved = JSON.parse(fs.readFileSync(REFUSAL_DOM, 'utf8')) as {
      detailText: string;
      reasonText: string;
      detailAria: string;
      aria: string;
    };
    expect(saved.detailText).toBe(EXACT_BUSY_REASON);
    expect(saved.reasonText).toBe('cannot-confirm-idle');
    expect(saved.detailAria).toBe(EXACT_BUSY_REASON);
    expect(saved.aria).toContain(EXACT_BUSY_REASON);
    expect(saved.aria).toContain('cannot-confirm-idle');
    expect(fs.statSync(REFUSAL_PNG).size).toBeGreaterThan(500);
  }, 60_000);
});
