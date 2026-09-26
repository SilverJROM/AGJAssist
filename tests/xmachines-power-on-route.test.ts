import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';

const OWNER_TOKEN = 'a10-owner-token';
const OWNER_ID = 1;
const LOOPBACK_HOST = 'localhost:3101';
const LOOPBACK_ORIGIN = 'http://localhost:3101';

// Temp PATH spy. The product child writes this sink; the test only reads it back.
// Line while held: <XMAC_CALLER>\t<arg1>\t<arg2>...
// A later line "exited" is written only when the child leaves the hold.
const SPY_SCRIPT = [
  '#!/usr/bin/env bash',
  'set -u',
  'log=${XMAC_C3_SPY_LOG:?XMAC_C3_SPY_LOG is required}',
  'release=${XMAC_C3_SPY_RELEASE:?XMAC_C3_SPY_RELEASE is required}',
  'caller=${XMAC_CALLER-}',
  '{',
  "  printf '%s' \"$caller\"",
  '  for arg in "$@"; do',
  "    printf '\\t%s' \"$arg\"",
  '  done',
  "  printf '\\n'",
  '} >> "$log"',
  'i=0',
  'while [ "$i" -lt 200 ]; do',
  '  if [ -f "$release" ]; then',
  '    break',
  '  fi',
  '  i=$((i + 1))',
  '  sleep 0.05',
  'done',
  "printf 'exited\\n' >> \"$log\"",
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
        token === OWNER_TOKEN ? { id: OWNER_ID, role: 'owner', username: 'owner' } : null,
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

interface SpyRecord {
  caller: string;
  argv: string[];
}

function spyText(spyLog: string): string {
  if (!fs.existsSync(spyLog)) return '';
  return fs.readFileSync(spyLog, 'utf8');
}

function spyRecords(spyLog: string): SpyRecord[] {
  return spyText(spyLog)
    .split('\n')
    .filter((line) => line.length > 0 && line !== 'exited')
    .map((line) => {
      const fields = line.split('\t');
      return { caller: fields[0] ?? '', argv: fields.slice(1) };
    });
}

async function waitForRecords(spyLog: string, minLines: number, timeoutMs = 2000): Promise<SpyRecord[]> {
  const deadline = Date.now() + timeoutMs;
  let rows = spyRecords(spyLog);
  while (rows.length < minLines && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = spyRecords(spyLog);
  }
  return spyRecords(spyLog);
}

describe('xmachines power ON route C3', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let release: string | undefined;
  let prev: NodeJS.ProcessEnv;

  afterEach(async () => {
    if (release) fs.writeFileSync(release, 'go\n');
    await new Promise((resolve) => setTimeout(resolve, 80));
    await app?.close();
    app = undefined;
    if (prev) {
      process.env.PATH = prev.PATH;
      restoreEnv('XMAC_C3_SPY_LOG', prev.XMAC_C3_SPY_LOG);
      restoreEnv('XMAC_C3_SPY_RELEASE', prev.XMAC_C3_SPY_RELEASE);
      restoreEnv('XMACHINES_ARM', prev.XMACHINES_ARM);
      restoreEnv('XMACHINES_STATUS_FIXTURE', prev.XMACHINES_STATUS_FIXTURE);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
    release = undefined;
  });

  async function boot(): Promise<{ spyLog: string }> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-power-on-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    const spy = path.join(bin, 'xmac.sh');
    fs.writeFileSync(spy, SPY_SCRIPT, { mode: 0o755 });
    fs.chmodSync(spy, 0o755);
    const spyLog = path.join(scratch, 'spy.log');
    release = path.join(scratch, 'release');
    prev = {
      PATH: process.env.PATH,
      XMAC_C3_SPY_LOG: process.env.XMAC_C3_SPY_LOG,
      XMAC_C3_SPY_RELEASE: process.env.XMAC_C3_SPY_RELEASE,
      XMACHINES_ARM: process.env.XMACHINES_ARM,
      XMACHINES_STATUS_FIXTURE: process.env.XMACHINES_STATUS_FIXTURE,
    };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_C3_SPY_LOG = spyLog;
    process.env.XMAC_C3_SPY_RELEASE = release;
    process.env.XMACHINES_ARM = '1';
    delete process.env.XMACHINES_STATUS_FIXTURE;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog };
  }

  function postOn(key?: string) {
    const headers = ownerHeaders();
    if (key !== undefined) headers['idempotency-key'] = key;
    return app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/media/power/on',
      headers,
    });
  }

  it('L15b: missing or blank idempotency key is refused and spawns nothing', async () => {
    const { spyLog } = await boot();
    const missing = await postOn();
    const blank = await postOn('   ');
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(spyRecords(spyLog)).toEqual([]);
    expect(spyText(spyLog)).toBe('');
  });

  it('D1a/L6i/L15e: keyed ON returns in-progress before the held spy exits and records caller plus argv', async () => {
    const { spyLog } = await boot();
    const started = Date.now();
    const res = await Promise.race([
      postOn('c3-keyed-media-on'),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('power POST blocked on xmac')), 1500);
      }),
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status?: string }).status).toBe('in-progress');
    expect(fs.existsSync(release!)).toBe(false);
    expect(await waitForRecords(spyLog, 1)).toEqual([
      { caller: '1+a10-owner-token', argv: ['up', 'media'] },
    ]);
    expect(spyText(spyLog).split('\n').filter((line) => line === 'exited')).toEqual([]);
    expect(fs.existsSync(release!)).toBe(false);
  });
});
