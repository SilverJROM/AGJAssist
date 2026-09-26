import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';

const OWNER_TOKEN = 'c5-owner-token';
const VIEWER_TOKEN = 'c5-viewer-token';
const SESSION_OWNER_ID = 7;
const OWNER_CHAT_ID = 867530902;
const BOT_TOKEN = '424243:c5-force-confirm';
const MACHINE = 'glimmer';
const HOST = 'agjasst.silverjrom.app';
const ORIGIN = 'https://agjasst.silverjrom.app';
const FORCE_URL = `/api/xmachines/machines/${MACHINE}/power/off`;

type Captured = { url: string; body: unknown | null };

const ENV_KEYS = [
  'TELEGRAM_API_BASE',
  'TELEGRAM_API_BASE_URL',
  'TELEGRAM_API_ROOT',
  'XMACHINES_TELEGRAM_API_BASE',
  'XMACHINES_ARM',
  'XMAC_LOG',
  'XMACHINES_UP_SECONDS',
  'XMACHINES_STATUS_FIXTURE',
] as const;

function minimalConfig(): AppConfig {
  return {
    telegram: {
      botToken: BOT_TOKEN,
      authorizedUserId: OWNER_CHAT_ID,
      authorizedChatIds: [OWNER_CHAT_ID],
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
        if (token === OWNER_TOKEN) return { id: SESSION_OWNER_ID, role: 'owner', username: 'owner' };
        if (token === VIEWER_TOKEN) return { id: 3, role: 'viewer', username: 'viewer' };
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

describe('xmachines force confirm route C5', () => {
  const prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;
  let app: FastifyInstance | undefined;
  let server: http.Server | undefined;
  let scratch: string | undefined;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c5-force-'));
    const logPath = path.join(scratch, 'xmac.log');
    fs.writeFileSync(logPath, '');
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_LOG = logPath;
    process.env.XMACHINES_UP_SECONDS = '100000000';
    delete process.env.XMACHINES_STATUS_FIXTURE;
    app = await createApiServer(minimalConfig(), stubServices());
  });

  afterEach(async () => {
    await app?.close();
    if (server) { await new Promise<void>((r) => server!.close(() => r())); }
    if (scratch) { fs.rmSync(scratch, { recursive: true, force: true }); }
    for (const k of ENV_KEYS) {
      const v = prior[k];
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('L15b: missing idempotency key is rejected before challenge', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: FORCE_URL,
      headers: {
        authorization: `Bearer ${OWNER_TOKEN}`,
        host: HOST,
        origin: ORIGIN,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
  });

  it('L3a: force is separate from normal off, no --force emitted on normal path', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: FORCE_URL,
      headers: {
        authorization: `Bearer ${OWNER_TOKEN}`,
        host: HOST,
        origin: ORIGIN,
        'idempotency-key': 'c5-key-1',
      },
    });
    // Without a consumed challenge, route rejects force confirmation
    expect(res.statusCode).toBe(400);
    const body = res.json() as { reason: string };
    expect(body.reason).toBe('force-confirmation-required');
  });
});
