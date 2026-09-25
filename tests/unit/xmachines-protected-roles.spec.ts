import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../../src/api/server.js';
import { AppConfig } from '../../src/config/config.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPY = path.join(REPO, 'tests/helpers/xmac-argv-spy.sh');
const LOCAL_OWNER = 'a4-owner-token';
const ARCHIVE_LEASE = 'xmac-claim-hdd-17-transcript-archive';

interface FixtureSpec {
  ips: Record<string, string>;
  signal?: 'live' | 'cleared';
  glimmer?: 'live' | 'cleared';
  leases?: string[];
  archiveWindow?: boolean;
}

function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${LOCAL_OWNER}`,
    host: 'localhost:3101',
    origin: 'http://localhost:3101',
    ...extra,
  };
}

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: '123:ABC',
      authorizedUserId: 1,
      authorizedChatIds: [1],
      testMode: true,
      updateMode: 'polling',
      webhookUrl: null,
      webhookPath: '/api/telegram/webhook',
      webhookSecretToken: 's',
    },
    runtime: {
      workspaceRoot: '/tmp',
      allowedCommandPrefixes: [],
      maxToolIterations: 1,
      defaultTimeoutMinutes: 1,
    },
    api: {
      port: 0,
      host: '127.0.0.1',
      jwtSecret: 's',
      sessionExpiryHours: 24,
    },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function stubServices(): ApiServices {
  return {
    authService: {
      verifyToken: (token: string) =>
        token === LOCAL_OWNER ? { id: 1, role: 'owner', username: 'owner' } : null,
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function spyArgv(spyLog: string): string[][] {
  if (!fs.existsSync(spyLog)) return [];
  return fs.readFileSync(spyLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').slice(1));
}

async function waitForArgv(spyLog: string, minLines: number, timeoutMs = 2000): Promise<string[][]> {
  const deadline = Date.now() + timeoutMs;
  let rows = spyArgv(spyLog);
  while (rows.length < minLines && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = spyArgv(spyLog);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  return spyArgv(spyLog);
}

async function expectNoSpawn(spyLog: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(spyArgv(spyLog)).toEqual([]);
}

function writeFixtures(dir: string, spec: FixtureSpec): void {
  const status: Record<string, { ip: string }> = {};
  for (const [name, ip] of Object.entries(spec.ips)) status[name] = { ip };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  fs.writeFileSync(path.join(dir, 'roles.json'), JSON.stringify({
    signal: spec.signal ?? 'cleared',
    glimmer: spec.glimmer ?? 'cleared',
  }));
  fs.writeFileSync(path.join(dir, 'leases.json'), JSON.stringify({ names: spec.leases ?? [] }));
  fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify({
    'transcript-archive': { active: spec.archiveWindow === true },
  }));
}

describe('xmachines protected roles on the armed power route', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let prev: NodeJS.ProcessEnv;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (prev) {
      restoreEnv('PATH', prev.PATH);
      restoreEnv('XMAC_ARGV_SPY_LOG', prev.XMAC_ARGV_SPY_LOG);
      restoreEnv('XMAC_ARGV_SPY_REAL', prev.XMAC_ARGV_SPY_REAL);
      restoreEnv('XMACHINES_ARM', prev.XMACHINES_ARM);
      restoreEnv('XMACHINES_PROTECTED_FIXTURE_DIR', prev.XMACHINES_PROTECTED_FIXTURE_DIR);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  async function boot(spec: FixtureSpec): Promise<{ spyLog: string; fixtures: string }> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-roles-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, 'xmac.sh'));
    const spyLog = path.join(scratch, 'spy.log');
    const fixtures = path.join(scratch, 'fixtures');
    writeFixtures(fixtures, spec);
    prev = {
      PATH: process.env.PATH,
      XMAC_ARGV_SPY_LOG: process.env.XMAC_ARGV_SPY_LOG,
      XMAC_ARGV_SPY_REAL: process.env.XMAC_ARGV_SPY_REAL,
      XMACHINES_ARM: process.env.XMACHINES_ARM,
      XMACHINES_PROTECTED_FIXTURE_DIR: process.env.XMACHINES_PROTECTED_FIXTURE_DIR,
    };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    delete process.env.XMAC_ARGV_SPY_REAL;
    process.env.XMACHINES_ARM = '1';
    process.env.XMACHINES_PROTECTED_FIXTURE_DIR = fixtures;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog, fixtures };
  }

  function postOff(machine: string, key: string) {
    return app!.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${machine}/power/off`,
      headers: ownerHeaders({ 'idempotency-key': key }),
    });
  }

  it('L4a gpu at .174 is refused while signal is live and xmac argv stays empty', async () => {
    const { spyLog } = await boot({
      ips: { gpu: '192.168.254.174' },
      signal: 'live',
    });
    const res = await postOff('gpu', 'l4a-gpu-off');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'signal',
      detail: 'signal',
    });
    await expectNoSpawn(spyLog);
  });

  it('L4a observed .174 on a non-gpu name is still signal and records zero argv', async () => {
    const { spyLog } = await boot({
      ips: { media: '192.168.254.174' },
      signal: 'live',
    });
    const res = await postOff('media', 'l4a-media-observed-174');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'signal',
      detail: 'signal',
    });
    await expectNoSpawn(spyLog);
  });

  it('L4a gpu whose observed address is not .174 stays controllable while signal is live', async () => {
    const { spyLog } = await boot({
      ips: { gpu: '10.9.8.7' },
      signal: 'live',
    });
    const res = await postOff('gpu', 'l4a-gpu-other-ip');
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status?: string }).status).toBe('in-progress');
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'gpu']]);
  });

  it('L4b/L4d gpu2 at .179 names glimmer and records zero argv', async () => {
    const { spyLog } = await boot({
      ips: { gpu2: '192.168.254.179' },
      glimmer: 'live',
    });
    const res = await postOff('gpu2', 'l4b-gpu2-off');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'glimmer',
      detail: 'glimmer',
    });
    await expectNoSpawn(spyLog);
  });

  it('L4c hdd at .169 is refused while the transcript-archive lease is held', async () => {
    const { spyLog } = await boot({
      ips: { hdd: '192.168.254.169' },
      leases: [ARCHIVE_LEASE],
      archiveWindow: false,
    });
    const res = await postOff('hdd', 'l4c-hdd-lease');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'transcript-archive',
      detail: 'transcript-archive',
    });
    await expectNoSpawn(spyLog);
  });

  it('L4c hdd at .169 is refused during the transcript-archive window', async () => {
    const { spyLog } = await boot({
      ips: { hdd: '192.168.254.169' },
      leases: [],
      archiveWindow: true,
    });
    const res = await postOff('hdd', 'l4c-hdd-window');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'transcript-archive',
      detail: 'transcript-archive',
    });
    await expectNoSpawn(spyLog);
  });

  it('L4c a non-archive lease outside the window still reaches down hdd', async () => {
    const { spyLog } = await boot({
      ips: { hdd: '192.168.254.169' },
      signal: 'live',
      leases: ['xmac-claim-hdd-17-scratch'],
      archiveWindow: false,
    });
    const res = await postOff('hdd', 'l4c-hdd-other-lease');
    expect(res.statusCode).toBe(202);
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'hdd']]);
  });

  it('L4e live signal and glimmer hard-refuse .174 and .179 with zero argv', async () => {
    const { spyLog } = await boot({
      ips: {
        gpu: '192.168.254.174',
        gpu2: '192.168.254.179',
      },
      signal: 'live',
      glimmer: 'live',
    });
    const gpu = await postOff('gpu', 'l4e-gpu-off');
    const gpu2 = await postOff('gpu2', 'l4e-gpu2-off');
    expect(gpu.statusCode).toBe(400);
    expect(gpu.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'signal',
      detail: 'signal',
    });
    expect(gpu2.statusCode).toBe(400);
    expect(gpu2.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'glimmer',
      detail: 'glimmer',
    });
    await expectNoSpawn(spyLog);
  });

  it('L4f removing the live role fixture lets the same .174 machine reach down gpu', async () => {
    const { spyLog, fixtures } = await boot({
      ips: { gpu: '192.168.254.174' },
      signal: 'live',
    });
    const refused = await postOff('gpu', 'l4f-gpu-protected');
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({
      status: 'rejected',
      reason: 'protected-role',
      role: 'signal',
      detail: 'signal',
    });
    await expectNoSpawn(spyLog);

    fs.unlinkSync(path.join(fixtures, 'roles.json'));
    const cleared = await postOff('gpu', 'l4f-gpu-cleared');
    expect(cleared.statusCode).toBe(202);
    const body = cleared.json() as { status?: string; operationId?: string };
    expect(body.status).toBe('in-progress');
    expect(typeof body.operationId).toBe('string');
    expect(body.operationId!.length).toBeGreaterThan(0);
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'gpu']]);
  });
});
