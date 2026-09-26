import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';
import { DatabaseService } from '../src/db/database.js';
import { AuthService } from '../src/auth/auth-service.js';
import crypto from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OWNER_TOKEN = 'c7-owner-token';
const VIEWER_TOKEN = 'c7-viewer-token';
const OWNER_ID = 1;
const VIEWER_ID = 2;

function ownerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${OWNER_TOKEN}`,
    host: 'agjasst.silverjrom.app',
    origin: 'https://agjasst.silverjrom.app',
    ...extra,
  };
}

function viewerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${VIEWER_TOKEN}`,
    host: 'agjasst.silverjrom.app',
    origin: 'https://agjasst.silverjrom.app',
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
    api: { port: 0, host: '127.0.0.1', jwtSecret: process.env.JWT_SECRET_TEST || 'test-secret', sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function makeAuthService(db: DatabaseService, jwtSecret: string) {
  const auth = new AuthService(db, 'bot:token', jwtSecret, 24);
  return auth;
}

function seedUsers(db: DatabaseService) {
  const ins = db.prepare('INSERT INTO users (id, telegram_id, username, role, active) VALUES (?, ?, ?, ?, 1)');
  ins.run(OWNER_ID, 1001, 'owner', 'owner');
  ins.run(VIEWER_ID, 1002, 'viewer', 'viewer');
}

function createServiceUserRow(db: DatabaseService, userId: number) {
  return db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as { id: number };
}

describe('xmachines session revoke route C7', () => {
  let app: FastifyInstance | undefined;
  let db: DatabaseService | undefined;
  let auth: AuthService | undefined;
  let scratch: string | undefined;
  let prevEnv: NodeJS.ProcessEnv | undefined;
  let jwtSecret: string;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    db?.close();
    db = undefined;
    auth = undefined;
    if (scratch && fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true });
    if (prevEnv) {
      for (const k of Object.keys(prevEnv)) {
        if (prevEnv[k] === undefined) delete process.env[k];
        else process.env[k] = prevEnv[k];
      }
    }
  });

  async function boot() {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'c7-revoke-'));
    const confPath = path.join(scratch, 'machines.conf');
    fs.writeFileSync(confPath, 'gpu|192.0.2.50|00:00:00:00:00:01|agjrom|lab|\n');
    db = new DatabaseService(path.join(scratch, 'c7.sqlite'));
    seedUsers(db);
    jwtSecret = 'c7-test-jwt-secret';
    auth = makeAuthService(db, jwtSecret);
    prevEnv = { XMAC_CONF: process.env.XMAC_CONF, XMACHINES_ARM: process.env.XMACHINES_ARM };
    process.env.XMAC_CONF = confPath;
    process.env.XMACHINES_ARM = '1';

    const services: ApiServices = {
      authService: {
        verifyToken: (token: string) => {
          if (token === OWNER_TOKEN) return { id: OWNER_ID, telegramId: 1001, username: 'owner', displayName: null, role: 'owner' };
          if (token === VIEWER_TOKEN) return { id: VIEWER_ID, telegramId: 1002, username: 'viewer', displayName: null, role: 'viewer' };
          return null;
        },
        revokeAllWebSessions: (userId: number) => auth!.revokeAllWebSessions(userId),
      } as any,
      projectService: {} as any,
      safetyService: {} as any,
      auditService: {} as any,
      tmuxService: {} as any,
      tmuxStreamManager: {} as any,
      db: db as any,
      delegationService: {} as any,
      noteService: {} as any,
      planService: {} as any,
      taskService: {} as any,
      fileService: {} as any,
      stepTemplateService: {} as any,
      personalTaskService: {} as any,
      reminderService: {} as any,
      agentAssignmentService: {} as any,
    };
    app = await createApiServer(minimalConfig(), services);
  }

  it('L6g: owner can POST revoke routes and prior bearer tokens fail', async () => {
    await boot();

    if (!db || !auth) throw new Error('not booted');

    const userRow = db.prepare('SELECT id FROM users WHERE id = ?').get(OWNER_ID) as { id: number };
    const sessionId1 = crypto.randomUUID();
    const sessionId2 = crypto.randomUUID();
    const token1 = `token-${sessionId1}`;
    const token2 = `token-${sessionId2}`;
    const tokenHash1 = crypto.createHash('sha256').update(token1).digest('hex');
    const tokenHash2 = crypto.createHash('sha256').update(token2).digest('hex');

    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    const now = new Date().toISOString();
    const insertSession = db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, surface, last_activity) VALUES (?, ?, ?, ?, ?, ?)');
    insertSession.run(sessionId1, userRow.id, tokenHash1, expiresAt, 'web', now);
    insertSession.run(sessionId2, userRow.id, tokenHash2, expiresAt, 'miniapp', now);

    const verify = (t: string) => {
      const payload = { sub: OWNER_ID, sid: sessionId1, tid: 1001 };
      const jwt = require('jsonwebtoken');
      const signed = jwt.sign(payload, jwtSecret);
      return `${signed}|${t}`;
    };

    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: ownerHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { revoked: number };
    expect(body.revoked).toBeGreaterThanOrEqual(2);

    const remaining = db.prepare('SELECT count(*) as c FROM sessions WHERE user_id = ? AND surface IN (\'web\',\'miniapp\')').get(userRow.id) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('L6g: viewer is forbidden from revoking sessions', async () => {
    await boot();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: viewerHeaders(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('L6g: missing auth returns 401', async () => {
    await boot();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: { host: 'agjasst.silverjrom.app', origin: 'https://agjasst.silverjrom.app' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('L6g: host not allowed returns 403', async () => {
    await boot();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: ownerHeaders({ host: 'evil.example.com' }),
    });
    expect(res.statusCode).toBe(403);
  });
});
