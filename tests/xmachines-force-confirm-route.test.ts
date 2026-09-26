import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPY_SRC = path.join(REPO, 'tests/helpers/xmac-argv-spy.sh');
const OWNER_TOKEN = 'c5-owner-token';
const OTHER_OWNER_TOKEN = 'c5-other-session';
const SESSION_OWNER_ID = 7;
const MACHINE = 'media';
const OTHER_MACHINE = 'gpu2';
const HOST = 'agjasst.silverjrom.app';
const ORIGIN = 'https://agjasst.silverjrom.app';
const FORCE_URL = `/api/xmachines/machines/${MACHINE}/power/force`;
const OFF_URL = `/api/xmachines/machines/${MACHINE}/power/off`;
const PROCESS_LINE = 'pid=44021 comm=c5-probe-worker';
const LEASE_LINE = 'lease=c5-hold-media-17';
const HOLDER_LINE = 'holder=seat-c5-probe';
const STATIC_STUB = 'processes=checked leases=checked';

const ENV_KEYS = [
  'PATH',
  'TELEGRAM_API_BASE',
  'TELEGRAM_API_BASE_URL',
  'TELEGRAM_API_ROOT',
  'XMACHINES_TELEGRAM_API_BASE',
  'XMACHINES_ARM',
  'XMAC_LOG',
  'XMAC_CONF',
  'XMAC_STATE',
  'XMAC_ARGV_SPY_LOG',
  'XMAC_USER',
  'XMACHINES_UP_SECONDS',
  'XMACHINES_STATUS_FIXTURE',
  'XMACHINES_FORCE_PROBE_FIXTURE',
  'XMACHINES_PROTECTED_FIXTURE_DIR',
] as const;

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: '424243:c5-force-confirm',
      authorizedUserId: 867530902,
      authorizedChatIds: [867530902],
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
    authService: {
      verifyToken: (token: string) => {
        if (token === OWNER_TOKEN || token === OTHER_OWNER_TOKEN) {
          return { id: SESSION_OWNER_ID, role: 'owner', username: 'owner' };
        }
        return null;
      },
    } as ApiServices['authService'],
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

interface ProbeFixture {
  processesText: string;
  leasesText: string;
  leaseHolders: string[];
}

interface Boot {
  app: FastifyInstance;
  spyLog: string;
  probeFile: string;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function verifiedLog(machine: string): string {
  const now = Date.now();
  const wake = stamp(now - 30 * 60 * 1000);
  const up = stamp(now - 20 * 60 * 1000);
  return `${wake} WAKE ${machine} 1\n${up} UP ${machine} 1\n`;
}

function readArgv(spyLog: string): string[][] {
  if (!fs.existsSync(spyLog)) return [];
  return fs.readFileSync(spyLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').slice(1));
}

async function waitForArgv(spyLog: string, min: number, spins = 100): Promise<string[][]> {
  let rows = readArgv(spyLog);
  for (let i = 0; i < spins && rows.length < min; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = readArgv(spyLog);
  }
  return readArgv(spyLog);
}

async function expectNoSpawn(spyLog: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const rows = readArgv(spyLog);
  expect(rows).toEqual([]);
  expect(rows.some((argv) => argv.includes('--force'))).toBe(false);
}

function expectNotUnknown(res: LightMyRequestResponse): void {
  expect(res.statusCode).not.toBe(404);
  const body = res.json() as { error?: string };
  expect(body.error).not.toBe('unknown-machine');
}

describe('xmachines force confirm route C5', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let prior: Record<string, string | undefined> | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await app?.close();
    app = undefined;
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
    if (prior) {
      for (const key of ENV_KEYS) {
        const value = prior[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    prior = undefined;
  });

  async function boot(opts: { wol?: 'verified' | 'never'; protectedRole?: boolean } = {}): Promise<Boot> {
    prior = {};
    for (const key of ENV_KEYS) prior[key] = process.env[key];
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-force-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    const spy = path.join(bin, 'xmac.sh');
    fs.copyFileSync(SPY_SRC, spy);
    fs.chmodSync(spy, 0o755);
    const spyLog = path.join(scratch, 'spy.log');
    const probeFile = path.join(scratch, 'force-probe.json');
    fs.writeFileSync(probeFile, JSON.stringify({
      processesText: PROCESS_LINE,
      leasesText: LEASE_LINE,
      leaseHolders: [HOLDER_LINE],
    }));
    const xmacLog = path.join(scratch, 'xmac.log');
    fs.writeFileSync(xmacLog, opts.wol === 'never' ? '' : verifiedLog(MACHINE));
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, [
      `${MACHINE}|192.0.2.50|02:00:00:00:00:32|agjrom|fixture|`,
      `${OTHER_MACHINE}|192.0.2.51|02:00:00:00:00:33|agjrom|fixture|`,
      '',
    ].join('\n'));
    const stateDir = path.join(scratch, 'xmac-state');
    fs.mkdirSync(stateDir);
    if (opts.protectedRole) {
      const fixture = path.join(scratch, 'protected');
      fs.mkdirSync(fixture);
      fs.writeFileSync(path.join(fixture, 'status.json'), JSON.stringify({ [MACHINE]: { ip: '192.0.2.174' } }));
      fs.writeFileSync(path.join(fixture, 'roles.json'), JSON.stringify({ signal: 'live' }));
      fs.writeFileSync(path.join(fixture, 'leases.json'), JSON.stringify({ names: [] }));
      fs.writeFileSync(path.join(fixture, 'schedule.json'), JSON.stringify({}));
      process.env.XMACHINES_PROTECTED_FIXTURE_DIR = fixture;
    } else {
      delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    }
    process.env.PATH = `${bin}${path.delimiter}${prior.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_STATE = stateDir;
    process.env.XMAC_LOG = xmacLog;
    process.env.XMAC_USER = 'agjrom';
    process.env.XMACHINES_UP_SECONDS = '3600';
    process.env.XMACHINES_FORCE_PROBE_FIXTURE = probeFile;
    delete process.env.XMACHINES_STATUS_FIXTURE;
    delete process.env.TELEGRAM_API_BASE;
    delete process.env.TELEGRAM_API_BASE_URL;
    delete process.env.TELEGRAM_API_ROOT;
    delete process.env.XMACHINES_TELEGRAM_API_BASE;
    app = await createApiServer(minimalConfig(), stubServices());
    return { app, spyLog, probeFile };
  }

  function post(
    ctx: Boot,
    url: string,
    token: string,
    key?: string,
    body?: Record<string, unknown>,
  ) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      host: HOST,
      origin: ORIGIN,
    };
    if (key !== undefined) headers['idempotency-key'] = key;
    return ctx.app.inject({
      method: 'POST',
      url,
      headers,
      ...(body === undefined ? {} : { payload: body }),
    });
  }

  async function openForce(ctx: Boot, key: string) {
    const res = await post(ctx, FORCE_URL, OWNER_TOKEN, key);
    expectNotUnknown(res);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status?: string;
      challengeId?: string;
      displayNumber?: number;
      confirmation?: string;
    };
    expect(body.status).toBe('challenge');
    expect(typeof body.challengeId).toBe('string');
    expect((body.challengeId ?? '').length).toBeGreaterThan(0);
    expect(Number.isInteger(body.displayNumber)).toBe(true);
    return body as { challengeId: string; displayNumber: number; confirmation: string };
  }

  it('L15b: a force POST without an idempotency key is rejected before a challenge', async () => {
    const ctx = await boot();
    const force = await post(ctx, FORCE_URL, OWNER_TOKEN);
    expectNotUnknown(force);
    expect(force.statusCode).toBe(400);
    expect(force.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });

    const off = await post(ctx, OFF_URL, OWNER_TOKEN);
    expectNotUnknown(off);
    expect(off.statusCode).toBe(400);
    expect(off.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    await expectNoSpawn(ctx.spyLog);
  });

  it('L3a: force confirmation spawns down --force once and normal off does not', async () => {
    const ctx = await boot({ wol: 'verified' });
    const opened = await openForce(ctx, 'c5-l3a-open');
    await expectNoSpawn(ctx.spyLog);

    const confirmed = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3a-confirm', {
      challengeId: opened.challengeId,
      selectedNumber: opened.displayNumber,
    });
    expectNotUnknown(confirmed);
    expect(confirmed.statusCode).toBe(202);
    expect(await waitForArgv(ctx.spyLog, 1)).toEqual([['down', MACHINE, '--force']]);

    const off = await post(ctx, OFF_URL, OWNER_TOKEN, 'c5-l3a-off');
    expectNotUnknown(off);
    expect(off.statusCode).toBe(202);
    const rows = await waitForArgv(ctx.spyLog, 2);
    expect(rows.filter((argv) => argv.includes('--force'))).toEqual([['down', MACHINE, '--force']]);
    expect(rows).toContainEqual(['down', MACHINE, '--owner-off']);
  });

  it('L3c: a consumed force challenge rejects the second confirm and spawns nothing more', async () => {
    const ctx = await boot();
    const opened = await openForce(ctx, 'c5-l3c-open');
    const first = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3c-once', {
      challengeId: opened.challengeId,
      selectedNumber: opened.displayNumber,
    });
    expectNotUnknown(first);
    expect(first.statusCode).toBe(202);
    expect(await waitForArgv(ctx.spyLog, 1)).toEqual([['down', MACHINE, '--force']]);

    const second = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3c-again', {
      challengeId: opened.challengeId,
      selectedNumber: opened.displayNumber,
    });
    expectNotUnknown(second);
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual({ status: 'rejected', reason: 'already-consumed' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readArgv(ctx.spyLog)).toEqual([['down', MACHINE, '--force']]);
  });

  it('L3d: a force challenge still confirms at 59999ms and expires at 60000ms', async () => {
    const ctx = await boot();
    const start = 1_790_356_108_000;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(start);
      const alive = await openForce(ctx, 'c5-l3d-alive-open');
      const expired = await openForce(ctx, 'c5-l3d-expired-open');

      vi.setSystemTime(start + 59_999);
      const stillValid = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3d-alive', {
        challengeId: alive.challengeId,
        selectedNumber: alive.displayNumber,
      });
      expectNotUnknown(stillValid);
      expect(stillValid.statusCode).toBe(202);
      expect(await waitForArgv(ctx.spyLog, 1)).toEqual([['down', MACHINE, '--force']]);

      vi.setSystemTime(start + 60_000);
      const tooLate = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3d-expired', {
        challengeId: expired.challengeId,
        selectedNumber: expired.displayNumber,
      });
      expectNotUnknown(tooLate);
      expect(tooLate.statusCode).toBe(400);
      expect(tooLate.json()).toEqual({ status: 'rejected', reason: 'expired' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(readArgv(ctx.spyLog)).toEqual([['down', MACHINE, '--force']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('L3e: a force challenge is refused for a different bearer and does not spawn', async () => {
    const ctx = await boot();
    const opened = await openForce(ctx, 'c5-l3e-open');
    const mismatch = await post(ctx, FORCE_URL, OTHER_OWNER_TOKEN, 'c5-l3e-other', {
      challengeId: opened.challengeId,
      selectedNumber: opened.displayNumber,
    });
    expectNotUnknown(mismatch);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toEqual({ status: 'rejected', reason: 'session-mismatch' });
    await expectNoSpawn(ctx.spyLog);

    const matched = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3e-owner', {
      challengeId: opened.challengeId,
      selectedNumber: opened.displayNumber,
    });
    expectNotUnknown(matched);
    expect(matched.statusCode).toBe(202);
    expect(await waitForArgv(ctx.spyLog, 1)).toEqual([['down', MACHINE, '--force']]);
  });

  it('L3f: a force challenge is refused on a different machine URL and does not spawn', async () => {
    const ctx = await boot();
    const opened = await openForce(ctx, 'c5-l3f-open');
    const mismatch = await post(
      ctx,
      `/api/xmachines/machines/${OTHER_MACHINE}/power/force`,
      OWNER_TOKEN,
      'c5-l3f-other',
      { challengeId: opened.challengeId, selectedNumber: opened.displayNumber },
    );
    expectNotUnknown(mismatch);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toEqual({ status: 'rejected', reason: 'machine-mismatch' });
    await expectNoSpawn(ctx.spyLog);

    const matched = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3f-media', {
      challengeId: opened.challengeId,
      selectedNumber: opened.displayNumber,
    });
    expectNotUnknown(matched);
    expect(matched.statusCode).toBe(202);
    expect(await waitForArgv(ctx.spyLog, 1)).toEqual([['down', MACHINE, '--force']]);
  });

  it('L3g: an off challenge cannot force, and a force challenge cannot confirm on off', async () => {
    const ctx = await boot({ wol: 'never' });
    const offOpen = await post(ctx, OFF_URL, OWNER_TOKEN, 'c5-l3g-off-open');
    expectNotUnknown(offOpen);
    expect(offOpen.statusCode).toBe(400);
    const offBody = offOpen.json() as { reason?: string; challengeId?: string; displayNumber?: number };
    expect(offBody.reason).toBe('force-confirmation-required');
    expect(typeof offBody.challengeId).toBe('string');
    expect(Number.isInteger(offBody.displayNumber)).toBe(true);

    const offOnForce = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3g-off-on-force', {
      challengeId: offBody.challengeId,
      selectedNumber: offBody.displayNumber,
    });
    expectNotUnknown(offOnForce);
    expect(offOnForce.statusCode).toBe(400);
    expect(offOnForce.json()).toEqual({ status: 'rejected', reason: 'action-mismatch' });
    await expectNoSpawn(ctx.spyLog);

    const forceOpen = await openForce(ctx, 'c5-l3g-force-open');
    const forceOnOff = await post(ctx, OFF_URL, OWNER_TOKEN, 'c5-l3g-force-on-off', {
      challengeId: forceOpen.challengeId,
      selectedNumber: forceOpen.displayNumber,
    });
    expectNotUnknown(forceOnOff);
    expect(forceOnOff.statusCode).toBe(400);
    expect(readArgv(ctx.spyLog).some((argv) => argv.includes('--force'))).toBe(false);

    const forceConfirm = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l3g-force-confirm', {
      challengeId: forceOpen.challengeId,
      selectedNumber: forceOpen.displayNumber,
    });
    expectNotUnknown(forceConfirm);
    expect(forceConfirm.statusCode).toBe(202);
    expect(await waitForArgv(ctx.spyLog, 1)).toEqual([['down', MACHINE, '--force']]);
  });

  it('L3h: confirmation text contains the probe fixture process and lease holder', async () => {
    const ctx = await boot();
    const opened = await openForce(ctx, 'c5-l3h-open');
    const fixture = JSON.parse(fs.readFileSync(ctx.probeFile, 'utf8')) as ProbeFixture;
    expect(fixture.processesText).toBe(PROCESS_LINE);
    expect(fixture.leasesText).toBe(LEASE_LINE);
    expect(fixture.leaseHolders).toEqual([HOLDER_LINE]);
    expect(opened.confirmation).toContain(fixture.processesText);
    expect(opened.confirmation).toContain(fixture.leasesText);
    expect(opened.confirmation).toContain(fixture.leaseHolders[0]);
    expect(opened.confirmation).not.toContain(STATIC_STUB);
    await expectNoSpawn(ctx.spyLog);
  });

  it('L6h: a protected role issues no challenge and spawns no force argv', async () => {
    const ctx = await boot({ wol: 'verified', protectedRole: true });
    const force = await post(ctx, FORCE_URL, OWNER_TOKEN, 'c5-l6h-force');
    expectNotUnknown(force);
    expect(force.statusCode).toBe(400);
    const forceBody = force.json() as { reason?: string; role?: string; challengeId?: string; displayNumber?: number };
    expect(forceBody.reason).toBe('protected-role');
    expect(forceBody.role).toBe('signal');
    expect(forceBody.challengeId).toBeUndefined();
    expect(forceBody.displayNumber).toBeUndefined();

    const off = await post(ctx, OFF_URL, OWNER_TOKEN, 'c5-l6h-off');
    expectNotUnknown(off);
    expect(off.statusCode).toBe(400);
    const offBody = off.json() as { reason?: string; challengeId?: string };
    expect(offBody.reason).toBe('protected-role');
    expect(offBody.challengeId).toBeUndefined();
    await expectNoSpawn(ctx.spyLog);
  });
});
