import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../../src/api/server.js';
import { AppConfig } from '../../src/config/config.js';
import { DatabaseService } from '../../src/db/database.js';
import { AuditService } from '../../src/services/audit-service.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPY = path.join(REPO, 'tests/helpers/xmac-argv-spy.sh');
const OWNER_ID = 42;
const VIEWER_ID = 77;
const OWNER_TOKEN = 'a16-owner-42';
const VIEWER_TOKEN = 'a16-viewer-77';
const FORCE_REASON = 'holder-pid-88421-not-default';
const REPLAY_KEY = 'a16-replay-media-on-not-a-default';

const REQUIRED_KEYS = [
  'request',
  'authorization',
  'pre_state',
  'guards',
  'force_reason',
  'target',
  'action',
  'gateway_status',
  'final_state',
  'actor_id',
  'session_id',
  'request_id',
  'request_source',
  'timestamps',
] as const;

const HOLD_SCRIPT = [
  '#!/bin/bash',
  'set -u',
  'release=${XMAC_ARGV_SPY_RELEASE:?}',
  'i=0',
  'while [ "$i" -lt 400 ]; do',
  '  if [ -f "$release" ]; then',
  '    exit 0',
  '  fi',
  '  i=$((i + 1))',
  '  sleep 0.05',
  'done',
  'exit 0',
  '',
].join('\n');

const MACHINES_CONF = [
  'gpu|192.0.2.50|00:00:00:00:00:01|agjrom|lab|',
  'hdd|192.0.2.51|00:00:00:00:00:02|agjrom|lab|',
  'gpu2|192.0.2.52|00:00:00:00:00:03|agjrom|lab|',
  'media|192.0.2.53|00:00:00:00:00:04|agjrom|lab|',
  '',
].join('\n');

type PowerRow = {
  id: number;
  user_id: number | null;
  action_type: string;
  details: Record<string, unknown>;
};

function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${OWNER_TOKEN}`,
    host: 'localhost:3101',
    origin: 'http://localhost:3101',
    ...extra,
  };
}

function viewerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${VIEWER_TOKEN}`,
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
    runtime: { workspaceRoot: '/tmp', allowedCommandPrefixes: [], maxToolIterations: 1, defaultTimeoutMinutes: 1 },
    api: { port: 0, host: '127.0.0.1', jwtSecret: 's', sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function servicesFor(db: DatabaseService): ApiServices {
  const audit = new AuditService(db);
  return {
    authService: {
      verifyToken: (token: string) => {
        if (token === OWNER_TOKEN) return { id: OWNER_ID, role: 'owner', username: 'owner-42' };
        if (token === VIEWER_TOKEN) return { id: VIEWER_ID, role: 'viewer', username: 'viewer-77' };
        return null;
      },
    } as ApiServices['authService'],
    projectService: {} as ApiServices['projectService'],
    safetyService: {} as ApiServices['safetyService'],
    auditService: audit,
    tmuxService: {} as ApiServices['tmuxService'],
    tmuxStreamManager: {} as ApiServices['tmuxStreamManager'],
    db,
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

function seedUsers(db: DatabaseService): void {
  const insert = db.prepare(
    'INSERT INTO users (id, telegram_id, username, role, active) VALUES (?, ?, ?, ?, 1)'
  );
  insert.run(OWNER_ID, 420042, 'owner-42', 'owner');
  insert.run(VIEWER_ID, 770077, 'viewer-77', 'viewer');
}

function powerRows(db: DatabaseService): PowerRow[] {
  const rows = db
    .prepare(
      "SELECT id, user_id, action_type, details FROM audit_log WHERE action_type = 'xmachines_power' ORDER BY id ASC"
    )
    .all() as Array<{ id: number; user_id: number | null; action_type: string; details: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    action_type: row.action_type,
    details: JSON.parse(row.details || '{}') as Record<string, unknown>,
  }));
}

function classificationOf(row: PowerRow): string {
  const value = row.details.classification;
  return typeof value === 'string' ? value : '';
}

function assertSchema(row: PowerRow): void {
  for (const key of REQUIRED_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(row.details, key), key).toBe(true);
    expect(row.details[key]).not.toBeUndefined();
  }
}

function spyArgv(spyLog: string): string[][] {
  if (!fs.existsSync(spyLog)) return [];
  return fs
    .readFileSync(spyLog, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').slice(1));
}

async function waitForArgv(spyLog: string, minLines: number): Promise<string[][]> {
  const deadline = Date.now() + 2000;
  let rows = spyArgv(spyLog);
  while (rows.length < minLines && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    rows = spyArgv(spyLog);
  }
  return spyArgv(spyLog);
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('xmachines power audit attempts A16', () => {
  let app: FastifyInstance | undefined;
  let db: DatabaseService | undefined;
  let scratch: string | undefined;
  let release: string | undefined;
  let prev: NodeJS.ProcessEnv | undefined;

  afterEach(async () => {
    if (release) fs.writeFileSync(release, 'go\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app?.close();
    app = undefined;
    db?.close();
    db = undefined;
    if (prev) {
      process.env.PATH = prev.PATH;
      restoreEnv('XMAC_ARGV_SPY_LOG', prev.XMAC_ARGV_SPY_LOG);
      restoreEnv('XMAC_ARGV_SPY_REAL', prev.XMAC_ARGV_SPY_REAL);
      restoreEnv('XMAC_ARGV_SPY_RELEASE', prev.XMAC_ARGV_SPY_RELEASE);
      restoreEnv('XMAC_CONF', prev.XMAC_CONF);
      restoreEnv('XMACHINES_ARM', prev.XMACHINES_ARM);
      restoreEnv('XMACHINES_PROTECTED_FIXTURE_DIR', prev.XMACHINES_PROTECTED_FIXTURE_DIR);
    }
    prev = undefined;
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
    release = undefined;
  });

  async function boot(arm: boolean): Promise<{ spyLog: string }> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a16-audit-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, 'xmac.sh'));
    const hold = path.join(scratch, 'hold.sh');
    fs.writeFileSync(hold, HOLD_SCRIPT, { mode: 0o755 });
    fs.chmodSync(hold, 0o755);
    const spyLog = path.join(scratch, 'spy.log');
    release = path.join(scratch, 'release');
    fs.writeFileSync(path.join(scratch, 'machines.conf'), MACHINES_CONF);
    db = new DatabaseService(path.join(scratch, 'audit.sqlite'));
    seedUsers(db);
    prev = {
      PATH: process.env.PATH,
      XMAC_ARGV_SPY_LOG: process.env.XMAC_ARGV_SPY_LOG,
      XMAC_ARGV_SPY_REAL: process.env.XMAC_ARGV_SPY_REAL,
      XMAC_ARGV_SPY_RELEASE: process.env.XMAC_ARGV_SPY_RELEASE,
      XMAC_CONF: process.env.XMAC_CONF,
      XMACHINES_ARM: process.env.XMACHINES_ARM,
      XMACHINES_PROTECTED_FIXTURE_DIR: process.env.XMACHINES_PROTECTED_FIXTURE_DIR,
    };
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    process.env.XMAC_ARGV_SPY_REAL = hold;
    process.env.XMAC_ARGV_SPY_RELEASE = release;
    process.env.XMAC_CONF = path.join(scratch, 'machines.conf');
    delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    if (arm) process.env.XMACHINES_ARM = '1';
    else delete process.env.XMACHINES_ARM;
    app = await createApiServer(minimalConfig(), servicesFor(db));
    return { spyLog };
  }

  it('D4a: an armed ON request writes an owner-attributed audit row', async () => {
    const { spyLog } = await boot(true);
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/media/power/on',
      headers: ownerHeaders({ 'idempotency-key': 'a16-on-media' }),
    });
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status?: string }).status).toBe('in-progress');
    expect(await waitForArgv(spyLog, 1)).toEqual([['up', 'media']]);
    const rows = powerRows(db!);
    expect(rows).toHaveLength(1);
    assertSchema(rows[0]);
    expect(classificationOf(rows[0])).toBe('on');
    expect(rows[0].user_id).toBe(OWNER_ID);
    expect(rows[0].details.actor_id).toBe(String(OWNER_ID));
    expect(rows[0].details.session_id).toBe(OWNER_TOKEN);
    expect(rows[0].details.target).toBe('media');
    expect(rows[0].details.action).toBe('on');
    expect(rows[0].details.force_reason).toBe('');
    expect((rows[0].details.authorization as { ok?: boolean }).ok).toBe(true);
  });

  it('D4b: an armed normal OFF request writes an owner-attributed audit row', async () => {
    const { spyLog } = await boot(true);
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/hdd/power/off',
      headers: ownerHeaders({ 'idempotency-key': 'a16-off-hdd' }),
    });
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status?: string }).status).toBe('in-progress');
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', 'hdd', '--owner-off']]);
    const rows = powerRows(db!);
    expect(rows).toHaveLength(1);
    assertSchema(rows[0]);
    expect(classificationOf(rows[0])).toBe('off');
    expect(rows[0].user_id).toBe(OWNER_ID);
    expect(rows[0].details.actor_id).toBe(String(OWNER_ID));
    expect(rows[0].details.target).toBe('hdd');
    expect(rows[0].details.action).toBe('off');
    expect(rows[0].details.force_reason).toBe('');
    expect((rows[0].details.authorization as { ok?: boolean }).ok).toBe(true);
  });

  it('D3c/D4c: an armed force attempt is owner-attributed and does not emit --force', async () => {
    const { spyLog } = await boot(true);
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/gpu2/power/off',
      headers: ownerHeaders({ 'idempotency-key': 'a16-force-gpu2', 'content-type': 'application/json' }),
      payload: { force: true, force_reason: FORCE_REASON },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'rejected', reason: 'force-confirmation-required' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(spyArgv(spyLog)).toEqual([]);
    const rows = powerRows(db!);
    expect(rows).toHaveLength(1);
    assertSchema(rows[0]);
    expect(classificationOf(rows[0])).toBe('force');
    expect(rows[0].user_id).toBe(OWNER_ID);
    expect(rows[0].details.actor_id).toBe(String(OWNER_ID));
    expect(rows[0].details.session_id).toBe(OWNER_TOKEN);
    expect(rows[0].details.target).toBe('gpu2');
    expect(rows[0].details.action).toBe('off');
    expect(rows[0].details.force_reason).toBe(FORCE_REASON);
    expect((rows[0].details.authorization as { ok?: boolean }).ok).toBe(true);
  });

  it('H1d: every control attempt in a mixed sequence writes one audit row', async () => {
    await boot(true);
    const responses = [
      await app!.inject({
        method: 'POST',
        url: '/api/xmachines/machines/media/power/on',
        headers: ownerHeaders({ 'idempotency-key': 'a16-h1-on' }),
      }),
      await app!.inject({
        method: 'POST',
        url: '/api/xmachines/machines/hdd/power/off',
        headers: ownerHeaders({ 'idempotency-key': 'a16-h1-off' }),
      }),
      await app!.inject({
        method: 'POST',
        url: '/api/xmachines/machines/gpu2/power/off',
        headers: ownerHeaders({ 'idempotency-key': 'a16-h1-force', 'content-type': 'application/json' }),
        payload: { force: true, force_reason: FORCE_REASON },
      }),
      await app!.inject({
        method: 'POST',
        url: '/api/xmachines/machines/media/power/on',
        headers: ownerHeaders({ 'idempotency-key': 'a16-h1-on' }),
      }),
      await app!.inject({
        method: 'POST',
        url: '/api/xmachines/machines/gpu/power/on',
        headers: viewerHeaders(),
      }),
    ];
    expect(responses.map((res) => res.statusCode)).toEqual([202, 202, 400, 202, 403]);
    const rows = powerRows(db!);
    expect(rows).toHaveLength(responses.length);
    expect(rows.map(classificationOf)).toEqual(['on', 'off', 'force', 'replayed', 'denied']);
    for (const row of rows) assertSchema(row);
    expect(rows[0].user_id).toBe(OWNER_ID);
    expect(rows[1].user_id).toBe(OWNER_ID);
    expect(rows[2].user_id).toBe(OWNER_ID);
    expect(rows[3].user_id).toBe(OWNER_ID);
    expect(rows[3].details.actor_id).toBe(String(OWNER_ID));
    expect(rows[4].user_id).toBe(VIEWER_ID);
  });

  it('L7n: a viewer power request is audited as denied', async () => {
    await boot(false);
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/gpu2/power/on',
      headers: viewerHeaders(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Owner role required' });
    const rows = powerRows(db!);
    expect(rows).toHaveLength(1);
    assertSchema(rows[0]);
    expect(classificationOf(rows[0])).toBe('denied');
    expect(rows[0].user_id).toBe(VIEWER_ID);
    expect(rows[0].details.actor_id).toBe(String(VIEWER_ID));
    expect(rows[0].details.session_id).toBe(VIEWER_TOKEN);
    expect(rows[0].details.target).toBe('gpu2');
    expect(rows[0].details.action).toBe('on');
    expect((rows[0].details.authorization as { ok?: boolean }).ok).toBe(false);
  });

  it('L7o: a second POST with the same idempotency key is audited as replayed', async () => {
    const { spyLog } = await boot(true);
    const first = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/media/power/on',
      headers: ownerHeaders({ 'idempotency-key': REPLAY_KEY }),
    });
    const second = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/media/power/on',
      headers: ownerHeaders({ 'idempotency-key': REPLAY_KEY }),
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(await waitForArgv(spyLog, 1)).toEqual([['up', 'media']]);
    const rows = powerRows(db!);
    expect(rows).toHaveLength(2);
    expect(rows.map(classificationOf)).toEqual(['on', 'replayed']);
    assertSchema(rows[1]);
    expect(rows[1].user_id).toBe(OWNER_ID);
    expect(rows[1].details.actor_id).toBe(String(OWNER_ID));
    expect(rows[1].details.session_id).toBe(OWNER_TOKEN);
    const request = rows[1].details.request as { idempotencyKey?: string; machine?: string; action?: string };
    expect(request.idempotencyKey).toBe(REPLAY_KEY);
    expect(request.machine).toBe('media');
    expect(request.action).toBe('on');
    expect((rows[1].details.authorization as { ok?: boolean }).ok).toBe(true);
  });

  it('L7p: the 429 from the power route limiter is audited as rate-limited', async () => {
    const { spyLog } = await boot(false);
    const url = '/api/xmachines/machines/hdd/power/off';
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app!.inject({ method: 'POST', url, headers: ownerHeaders() });
      statuses.push(res.statusCode);
    }
    const blocked = await app!.inject({ method: 'POST', url, headers: ownerHeaders() });
    expect(statuses).toEqual(Array(10).fill(403));
    expect(blocked.statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(spyArgv(spyLog)).toEqual([]);
    const rows = powerRows(db!);
    expect(rows).toHaveLength(11);
    const limited = rows.filter((row) => classificationOf(row) === 'rate-limited');
    expect(limited).toHaveLength(1);
    assertSchema(limited[0]);
    expect(limited[0].user_id).toBe(OWNER_ID);
    expect(limited[0].details.actor_id).toBe(String(OWNER_ID));
    expect(limited[0].details.session_id).toBe(OWNER_TOKEN);
    expect(limited[0].details.target).toBe('hdd');
    expect(limited[0].details.action).toBe('off');
    expect(limited[0].details.request_source).toBe('api');
    expect((limited[0].details.authorization as { ok?: boolean }).ok).toBe(true);
    expect(rows.filter((row) => classificationOf(row) === 'denied')).toHaveLength(10);
  });
});
