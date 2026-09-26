import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';
import { DatabaseService } from '../src/db/database.js';
import { AuditService } from '../src/services/audit-service.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_ID = 42;
const VIEWER_ID = 77;
const OWNER_TOKEN = 'a16-owner-42';
const VIEWER_TOKEN = 'a16-viewer-77';

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

function powerRows(db: DatabaseService): Array<{ id: number; details: Record<string, unknown> }> {
  const rows = db
    .prepare(
      "SELECT id, details FROM audit_log WHERE action_type = 'xmachines_power' ORDER BY id ASC"
    )
    .all() as Array<{ id: number; details: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    details: JSON.parse(row.details || '{}') as Record<string, unknown>,
  }));
}

function assertSchema(details: Record<string, unknown>): void {
  for (const key of REQUIRED_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(details, key), `missing key ${String(key)}`).toBe(true);
    expect(details[key]).not.toBeUndefined();
  }
}

describe('xmachines power audit read route C6', () => {
  let app: FastifyInstance | undefined;
  let db: DatabaseService | undefined;
  let scratch: string | undefined;
  let prev: NodeJS.ProcessEnv | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    db?.close();
    db = undefined;
    if (prev) {
      for (const k of Object.keys(prev)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  async function boot(arm: boolean): Promise<void> {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c6-audit-'));
    const machinesConf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(machinesConf, 'gpu|192.0.2.50|00:00:00:00:00:01|agjrom|lab|\n');
    db = new DatabaseService(path.join(scratch, 'audit.sqlite'));
    seedUsers(db);
    prev = {
      XMAC_CONF: process.env.XMAC_CONF,
      XMACHINES_ARM: process.env.XMACHINES_ARM,
    };
    process.env.XMAC_CONF = machinesConf;
    if (arm) process.env.XMACHINES_ARM = '1';
    else delete process.env.XMACHINES_ARM;
    app = await createApiServer(minimalConfig(), servicesFor(db));
  }

  it('L7r: power-audit view rejects non-owner', async () => {
    await boot(true);
    const res = await app!.inject({
      method: 'GET',
      url: '/api/xmachines/audit?limit=1',
      headers: viewerHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('D4d and L7s: owner can view power audit rows with complete stored details', async () => {
    await boot(true);
    // create a power action to generate an audit row
    const post = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/machines/gpu/power/on',
      headers: ownerHeaders({ 'idempotency-key': 'c6-test' }),
    });
    expect(post.statusCode).toBe(202);
    const rowsBefore = powerRows(db!);
    expect(rowsBefore.length).toBeGreaterThan(0);
    // read audit via new route
    const res = await app!.inject({
      method: 'GET',
      url: '/api/xmachines/audit?limit=1',
      headers: ownerHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: Array<{ details: string }> };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);
    const first = JSON.parse(body.entries[0].details) as Record<string, unknown>;
    assertSchema(first);
    // ensure payload matches stored row
    const stored = powerRows(db!)[0];
    expect(first).toEqual(stored.details);
  });
});
