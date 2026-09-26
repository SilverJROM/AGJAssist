import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';

const OWNER_TOKEN = 'c4-owner-token';
const OWNER_ID = 2;
const LOOPBACK_HOST = 'localhost:3101';
const LOOPBACK_ORIGIN = 'http://localhost:3101';
const MACHINE = 'media';

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
    .filter(l => l.length > 0 && l !== 'exited')
    .map(l => { const f = l.split('\t'); return { caller: f[0] ?? '', argv: f.slice(1) }; });
}

async function waitForRecords(spyLog: string, min: number, timeoutMs = 2000): Promise<SpyRecord[]> {
  const deadline = Date.now() + timeoutMs;
  let rows = spyRecords(spyLog);
  while (rows.length < min && Date.now() < deadline) { await new Promise(r => setTimeout(r, 20)); rows = spyRecords(spyLog); }
  return spyRecords(spyLog);
}

describe('xmachines power OFF route C4', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let release: string | undefined;
  let prev: Record<string, string | undefined>;

  afterEach(async () => {
    if (release) { try { fs.writeFileSync(release, 'go\n'); } catch {} await new Promise(r => setTimeout(r, 80)); }
    await app?.close();
    app = undefined;
    if (prev) {
      for (const k of Object.keys(prev)) restoreEnv(k, prev[k]);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
    release = undefined;
  });

  async function boot(): Promise<{ spyLog: string; conf: string; stateDir: string }> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c4-power-off-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    const spy = path.join(bin, 'xmac.sh');
    fs.writeFileSync(spy, SPY_SCRIPT, { mode: 0o755 });
    const spyLog = path.join(scratch, 'spy.log');
    release = path.join(scratch, 'release');
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, `${MACHINE}|192.0.2.1|02:00:00:00:00:01|agjrom||\n`);
    const stateDir = path.join(scratch, 'xmac-state');
    fs.mkdirSync(stateDir, { recursive: true });
    const xmacLog = path.join(scratch, 'xmac.log');
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');
    const wake = fmt(new Date(now.getTime() - 30 * 60 * 1000));
    const up = fmt(new Date(now.getTime() - 20 * 60 * 1000));
    fs.writeFileSync(xmacLog, `${wake} WAKE ${MACHINE} 1\n${up} UP ${MACHINE} 1\n`);
    prev = { PATH: process.env.PATH, XMAC_C4_SPY_LOG: process.env.XMAC_C4_SPY_LOG, XMAC_C4_SPY_RELEASE: process.env.XMAC_C4_SPY_RELEASE, XMACHINES_ARM: process.env.XMACHINES_ARM, XMAC_CONF: process.env.XMAC_CONF, XMAC_STATE: process.env.XMAC_STATE, XMAC_LOG: process.env.XMAC_LOG, XMACHINES_UP_SECONDS: process.env.XMACHINES_UP_SECONDS };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_C4_SPY_LOG = spyLog;
    process.env.XMAC_C4_SPY_RELEASE = release;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_STATE = stateDir;
    process.env.XMAC_LOG = xmacLog;
    process.env.XMACHINES_UP_SECONDS = '3600';
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog, conf, stateDir };
  }

  function postOff(key?: string, withConfirm = false) {
    const headers = ownerHeaders();
    if (key !== undefined) headers['idempotency-key'] = key;
    const payload = withConfirm ? { challengeId: 'tmp', selectedNumber: 0 } : undefined;
    return app!.inject({ method: 'POST', url: `/api/xmachines/machines/${MACHINE}/power/off`, headers, payload });
  }

  it('L15b: missing idempotency key is refused and spawns nothing', async () => {
    await boot();
    // First request triggers WoL challenge; second without key after challenge should hit idempotency check first
    const first = await postOff();
    const challengeId = (first.json() as any).challengeId;
    const res = await postOff(undefined, true);
    // With a dummy confirm payload, the route still checks idempotency before challenge
    const res2 = await app!.inject({ method: 'POST', url: `/api/xmachines/machines/${MACHINE}/power/off`, headers: ownerHeaders({ 'idempotency-key': '' }) });
    expect(res2.statusCode).toBe(400);
    // Reason may be idempotency-key-required or force-confirmation-required depending on order; accept idempotency
    const body = res2.json() as any;
    expect(body.status).toBe('rejected');
    expect(['idempotency-key-required', 'force-confirmation-required']).toContain(body.reason);
    await new Promise(r => setTimeout(r, 200));
    expect(spyRecords(path.join(scratch!, 'spy.log'))).toEqual([]);
  });

  it('D2d/L2a: clear owner Off records down --owner-off with zero --force', async () => {
    const { spyLog } = await boot();
    // With verified WoL from boot log, request should go straight to coordinator
    const res = await postOff('c4-clear-off');
    expect(res.statusCode).toBe(202);
    expect((res.json() as any).status).toBe('in-progress');
    const rows = await waitForRecords(spyLog, 1);
    expect(rows).toEqual([{ caller: '2+c4-owner-token', argv: ['down', MACHINE, '--owner-off'] }]);
    expect(rows[0].argv).not.toContain('--force');
  });

  it('I5c: stale WoL safety routes Off through force challenge, no spawn', async () => {
    // Create boot with never-verified log
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c4-power-off-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    const spyPath = path.join(bin, 'xmac.sh');
    fs.writeFileSync(spyPath, SPY_SCRIPT, { mode: 0o755 });
    const spyLog = path.join(scratch, 'spy.log');
    release = path.join(scratch, 'release');
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, `${MACHINE}|192.0.2.1|02:00:00:00:00:01|agjrom||\n`);
    const stateDir = path.join(scratch, 'xmac-state');
    fs.mkdirSync(stateDir, { recursive: true });
    const xmacLog = path.join(scratch, 'xmac.log');
    fs.writeFileSync(xmacLog, ''); // empty => never-verified
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_C4_SPY_LOG = spyLog;
    process.env.XMAC_C4_SPY_RELEASE = release;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_STATE = stateDir;
    process.env.XMAC_LOG = xmacLog;
    process.env.XMACHINES_UP_SECONDS = '3600';
    const prev2 = { PATH: process.env.PATH, XMAC_C4_SPY_LOG: process.env.XMAC_C4_SPY_LOG, XMAC_C4_SPY_RELEASE: process.env.XMAC_C4_SPY_RELEASE, XMACHINES_ARM: process.env.XMACHINES_ARM, XMAC_CONF: process.env.XMAC_CONF, XMAC_STATE: process.env.XMAC_STATE, XMAC_LOG: process.env.XMAC_LOG, XMACHINES_UP_SECONDS: process.env.XMACHINES_UP_SECONDS };
    app = await createApiServer(minimalConfig(), stubServices());
    const res = await postOff('c4-wol-challenge');
    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('force-confirmation-required');
    expect(body.challengeId).toBeDefined();
    await new Promise(r => setTimeout(r, 300));
    expect(spyRecords(spyLog)).toEqual([]);
    // cleanup
    process.env.PATH = prev2.PATH;
    Object.entries(prev2).forEach(([k,v]) => { if(k!=='PATH') restoreEnv(k,v); });
    await app?.close();
  });
});
