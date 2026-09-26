import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';

const OWNER_TOKEN = 'c8-owner-token';
const VIEWER_TOKEN = 'c8-viewer-token';
const SESSION_OWNER_ID = 2;
const OWNER_CHAT_ID = 867530901;
const BOT_TOKEN = '424242:c8-force-wire';
const MACHINE = 'media';
const HOST = 'agjasst.silverjrom.app';
const ORIGIN = 'https://agjasst.silverjrom.app';
const PROMPT = 'Force off number-match: tap the number shown on your screen';
const OFF_URL = `/api/xmachines/machines/${MACHINE}/power/off`;

type SendBody = {
  chat_id?: number;
  text?: string;
  reply_markup?: { inline_keyboard?: { text?: string }[][] };
};

type Captured = { url: string; body: SendBody | null };

const ENV_KEYS = [
  'TELEGRAM_API_BASE',
  'TELEGRAM_API_BASE_URL',
  'TELEGRAM_API_ROOT',
  'XMACHINES_TELEGRAM_API_BASE',
  'BOT_TOKEN',
  'AUTHORIZED_USER_ID',
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

describe('xmachines force challenge route capture C8', () => {
  const prior = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;
  let app: FastifyInstance | undefined;
  let server: http.Server | undefined;
  let scratch: string | undefined;
  let captured: Captured[];

  function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${OWNER_TOKEN}`,
      host: HOST,
      origin: ORIGIN,
      ...extra,
    };
  }

  beforeEach(async () => {
    captured = [];
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        let body: SendBody | null = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SendBody; } catch { body = null; }
        captured.push({ url: req.url || '', body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c8-force-'));
    const logPath = path.join(scratch, 'xmac.log');
    fs.writeFileSync(logPath, '');
    process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
    delete process.env.TELEGRAM_API_BASE_URL;
    delete process.env.TELEGRAM_API_ROOT;
    delete process.env.XMACHINES_TELEGRAM_API_BASE;
    // Different from config.telegram. A sender that reads the env instead of
    // the booted config would address this identity.
    process.env.BOT_TOKEN = 'env-bot-not-the-owner-sender';
    process.env.AUTHORIZED_USER_ID = '555001';
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_LOG = logPath;
    process.env.XMACHINES_UP_SECONDS = '100000000';
    delete process.env.XMACHINES_STATUS_FIXTURE;
    app = await createApiServer(minimalConfig(), stubServices());
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (server) {
      const closing = server;
      server = undefined;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
    if (scratch) {
      fs.rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
    for (const key of ENV_KEYS) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('D3a: unauthenticated and viewer tokens are rejected before a force challenge', async () => {
    const headers = { host: HOST, origin: ORIGIN, 'idempotency-key': 'c8-unauth-key' };
    const unauth = await app!.inject({
      method: 'POST',
      url: OFF_URL,
      headers,
    });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json()).toEqual({ error: 'Missing or invalid authorization header' });

    const viewer = await app!.inject({
      method: 'POST',
      url: OFF_URL,
      headers: { ...headers, authorization: `Bearer ${VIEWER_TOKEN}`, 'idempotency-key': 'c8-viewer-key' },
    });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json()).toEqual({ error: 'Owner role required' });
    expect(captured).toEqual([]);
  });

  it('L15b: an owner POST without an idempotency key is rejected', async () => {
    const missing = await app!.inject({
      method: 'POST',
      url: OFF_URL,
      headers: ownerHeaders(),
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ status: 'rejected', reason: 'idempotency-key-required' });
    expect(captured).toEqual([]);
  });

  it('D3b L3b: owner force-off on an allowed host captures the production number-match update', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: OFF_URL,
      headers: ownerHeaders({ 'idempotency-key': 'c8-owner-force-key' }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; displayNumber?: number };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('force-confirmation-required');
    expect(typeof body.displayNumber).toBe('number');

    const hits = captured.filter((row) => row.url === `/bot${BOT_TOKEN}/sendMessage`);
    expect(hits).toHaveLength(1);
    expect(hits[0].body?.chat_id).toBe(OWNER_CHAT_ID);
    const lines = hits[0].body?.text?.split('\n') ?? [];
    expect(lines).toContain(PROMPT);
    expect(lines).toContain(MACHINE);
    expect(lines).toContain(String(body.displayNumber));
    const labels = hits[0].body?.reply_markup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels).toContain(String(body.displayNumber));
  });
});
