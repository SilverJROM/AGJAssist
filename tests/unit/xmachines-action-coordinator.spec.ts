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
const LOCAL_OWNER = 'a10-owner-token';

const HOLD_SCRIPT = [
  '#!/bin/bash',
  'set -u',
  'release=${XMAC_ARGV_SPY_RELEASE:?}',
  'i=0',
  'while [ "$i" -lt 80 ]; do',
  '  if [ -f "$release" ]; then',
  '    exit 0',
  '  fi',
  '  i=$((i + 1))',
  '  sleep 0.05',
  'done',
  'exit 0',
  '',
].join('\n');

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

describe('xmachines action coordinator A10', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let release: string | undefined;
  let prev: NodeJS.ProcessEnv;

  afterEach(async () => {
    if (release) fs.writeFileSync(release, 'go\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app?.close();
    app = undefined;
    if (prev) {
      process.env.PATH = prev.PATH;
      restoreEnv('XMAC_ARGV_SPY_LOG', prev.XMAC_ARGV_SPY_LOG);
      restoreEnv('XMAC_ARGV_SPY_REAL', prev.XMAC_ARGV_SPY_REAL);
      restoreEnv('XMAC_ARGV_SPY_RELEASE', prev.XMAC_ARGV_SPY_RELEASE);
      restoreEnv('XMACHINES_ARM', prev.XMACHINES_ARM);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
    release = undefined;
  });

  async function boot(): Promise<{ spyLog: string }> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a10-coord-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, 'xmac.sh'));
    const hold = path.join(scratch, 'hold.sh');
    fs.writeFileSync(hold, HOLD_SCRIPT, { mode: 0o755 });
    fs.chmodSync(hold, 0o755);
    const spyLog = path.join(scratch, 'spy.log');
    release = path.join(scratch, 'release');
    prev = {
      PATH: process.env.PATH,
      XMAC_ARGV_SPY_LOG: process.env.XMAC_ARGV_SPY_LOG,
      XMAC_ARGV_SPY_REAL: process.env.XMAC_ARGV_SPY_REAL,
      XMAC_ARGV_SPY_RELEASE: process.env.XMAC_ARGV_SPY_RELEASE,
      XMACHINES_ARM: process.env.XMACHINES_ARM,
    };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    process.env.XMAC_ARGV_SPY_REAL = hold;
    process.env.XMAC_ARGV_SPY_RELEASE = release;
    process.env.XMACHINES_ARM = '1';
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog };
  }

  function post(
    machine: string,
    action: 'on' | 'off',
    key?: string,
    headerName: 'idempotency-key' | 'x-idempotency-key' = 'idempotency-key',
  ) {
    const headers = ownerHeaders();
    if (key !== undefined) headers[headerName] = key;
    return app!.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${machine}/power/${action}`,
      headers,
    });
  }

  async function postWithin(
    machine: string,
    action: 'on' | 'off',
    key: string,
    headerName: 'idempotency-key' | 'x-idempotency-key' = 'idempotency-key',
  ) {
    const started = Date.now();
    const res = await Promise.race([
      post(machine, action, key, headerName),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('power POST blocked on xmac')), 1500);
      }),
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
    return res;
  }

  it('L15b: a power POST without an idempotency key is refused before xmac', async () => {
    const { spyLog } = await boot();
    const missing = await post('gpu2', 'on');
    const blank = await post('gpu2', 'off', '   ');
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(spyArgv(spyLog)).toEqual([]);
  });

  it('L15c/L15e: armed power POST returns in-progress before the held xmac child exits', async () => {
    const { spyLog } = await boot();
    const res = await postWithin('media', 'on', 'caller-supplied-media-on', 'x-idempotency-key');
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status?: string; operationId?: string };
    expect(body.status).toBe('in-progress');
    expect(typeof body.operationId).toBe('string');
    expect(body.operationId!.length).toBeGreaterThan(0);
    expect(fs.existsSync(release!)).toBe(false);
    expect(await waitForArgv(spyLog, 1)).toEqual([['up', 'media']]);
  });

  it('L15a: each machine has its own mutex', async () => {
    const { spyLog } = await boot();
    const gpu = await postWithin('gpu', 'on', 'mutex-gpu-on');
    const hdd = await postWithin('hdd', 'on', 'mutex-hdd-on');
    expect(gpu.statusCode).toBe(202);
    expect(hdd.statusCode).toBe(202);
    const gpuBody = gpu.json() as { operationId: string };
    const hddBody = hdd.json() as { operationId: string };
    expect(gpuBody.operationId).not.toBe(hddBody.operationId);
    const blocked = await postWithin('gpu', 'off', 'mutex-gpu-off');
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toEqual({ status: 'rejected', reason: 'machine-busy' });
    expect(await waitForArgv(spyLog, 2)).toEqual([['up', 'gpu'], ['up', 'hdd']]);
  });

  it('L15d/L15g: a double-click with one key yields one operation and one gateway argv', async () => {
    const { spyLog } = await boot();
    const first = await postWithin('hdd', 'off', 'double-click-hdd-off');
    const second = await postWithin('hdd', 'off', 'double-click-hdd-off');
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect((first.json() as { status: string }).status).toBe('in-progress');
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'hdd']]);
  });

  it('L15h: two tabs with different keys yield one operation and one gateway argv', async () => {
    const { spyLog } = await boot();
    const tabA = await postWithin('gpu2', 'on', 'tab-a-gpu2');
    const tabB = await postWithin('gpu2', 'on', 'tab-b-gpu2-different');
    expect(tabA.statusCode).toBe(202);
    expect(tabB.statusCode).toBe(202);
    expect(tabB.json()).toEqual(tabA.json());
    expect(await waitForArgv(spyLog, 1)).toEqual([['up', 'gpu2']]);
  });

  it('L15i: a timeout retry with the same key rejoins the in-flight operation', async () => {
    const { spyLog } = await boot();
    const first = await postWithin('media', 'off', 'retry-media-off');
    const retry = await postWithin('media', 'off', 'retry-media-off');
    expect(first.statusCode).toBe(202);
    expect(retry.statusCode).toBe(202);
    const firstBody = first.json() as { status: string; operationId: string };
    const retryBody = retry.json() as { status: string; operationId: string };
    expect(firstBody.status).toBe('in-progress');
    expect(retryBody.operationId).toBe(firstBody.operationId);
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'media']]);
  });

  it('L15f: a completed action starts the per-machine cooldown', async () => {
    const { spyLog } = await boot();
    const first = await postWithin('gpu', 'on', 'cooldown-gpu-on');
    expect(first.statusCode).toBe(202);
    expect(await waitForArgv(spyLog, 1)).toEqual([['up', 'gpu']]);
    fs.writeFileSync(release!, 'go\n');
    let cooled = false;
    for (let i = 0; i < 20 && !cooled; i++) {
      const next = await post('gpu', 'off', 'cooldown-gpu-off');
      const body = next.json() as { status?: string; reason?: string };
      if (body.status === 'in-progress') break;
      if (next.statusCode === 400 && body.reason === 'cooldown') {
        cooled = true;
        expect(body).toEqual({ status: 'rejected', reason: 'cooldown' });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(cooled).toBe(true);
    expect(spyArgv(spyLog)).toEqual([['up', 'gpu']]);
  });

  it('L15j: ON during OFF is refused and does not overlap gateway argv', async () => {
    const { spyLog } = await boot();
    const off = await postWithin('hdd', 'off', 'off-during-on-off');
    const on = await postWithin('hdd', 'on', 'off-during-on-on');
    expect(off.statusCode).toBe(202);
    expect((off.json() as { status: string }).status).toBe('in-progress');
    expect(on.statusCode).toBe(400);
    expect(on.json()).toEqual({ status: 'rejected', reason: 'machine-busy' });
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'hdd']]);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
