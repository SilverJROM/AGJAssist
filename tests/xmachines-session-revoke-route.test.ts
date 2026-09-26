import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../src/api/server.js';
import { AppConfig } from '../src/config/config.js';
import { DatabaseService } from '../src/db/database.js';
import { AuthService } from '../src/auth/auth-service.js';

const OWNER_ID = 1;
const VIEWER_ID = 2;
const OWNER_TELEGRAM_ID = 1001;
const VIEWER_TELEGRAM_ID = 1002;
const JWT_SECRET = 'c7-test-jwt-secret';
const CANONICAL_HOST = 'agjasst.silverjrom.app';
const CANONICAL_ORIGIN = 'https://agjasst.silverjrom.app';

function bearerHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    host: CANONICAL_HOST,
    origin: CANONICAL_ORIGIN,
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
    api: { port: 0, host: '127.0.0.1', jwtSecret: JWT_SECRET, sessionExpiryHours: 24 },
    db: { path: ':memory:' },
    projects: { root: '/tmp' },
    tmux: { historyRetentionDays: 1, outputBufferLines: 100, streamIntervalMs: 100 },
    overmind: { token: 't' },
  };
}

function seedUsers(db: DatabaseService) {
  const ins = db.prepare('INSERT INTO users (id, telegram_id, username, role, active) VALUES (?, ?, ?, ?, 1)');
  ins.run(OWNER_ID, OWNER_TELEGRAM_ID, 'owner', 'owner');
  ins.run(VIEWER_ID, VIEWER_TELEGRAM_ID, 'viewer', 'viewer');
}

/** JWT whose sid and sha256 match a session row verifyToken will accept. */
function mintBoundSession(
  database: DatabaseService,
  userId: number,
  telegramId: number,
  surface: 'web' | 'miniapp',
): string {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign(
    { sub: userId, sid: sessionId, tid: telegramId },
    JWT_SECRET,
    { expiresIn: '24h' },
  );
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  database.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, surface) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, userId, tokenHash, expiresAt, surface);
  return token;
}

describe('xmachines session revoke route C7', () => {
  let app: FastifyInstance | undefined;
  let db: DatabaseService | undefined;
  let auth: AuthService | undefined;
  let scratch: string | undefined;
  let prevEnv: NodeJS.ProcessEnv | undefined;

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
    auth = new AuthService(db, 'bot:token', JWT_SECRET, 24);
    prevEnv = { XMAC_CONF: process.env.XMAC_CONF, XMACHINES_ARM: process.env.XMACHINES_ARM };
    process.env.XMAC_CONF = confPath;
    process.env.XMACHINES_ARM = '1';

    const services: ApiServices = {
      authService: auth,
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

    const token1 = mintBoundSession(db, OWNER_ID, OWNER_TELEGRAM_ID, 'web');
    const token2 = mintBoundSession(db, OWNER_ID, OWNER_TELEGRAM_ID, 'miniapp');

    expect(auth.verifyToken(token1)).toEqual({
      id: OWNER_ID,
      telegramId: OWNER_TELEGRAM_ID,
      username: 'owner',
      displayName: null,
      role: 'owner',
    });
    expect(auth.verifyToken(token2)).toEqual({
      id: OWNER_ID,
      telegramId: OWNER_TELEGRAM_ID,
      username: 'owner',
      displayName: null,
      role: 'owner',
    });

    const meBefore = await app!.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: bearerHeaders(token2),
    });
    expect(meBefore.statusCode).toBe(200);
    expect((meBefore.json() as { user: { id: number; role: string } }).user).toMatchObject({
      id: OWNER_ID,
      role: 'owner',
    });

    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: bearerHeaders(token1),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { revoked: number };
    expect(body.revoked).toBe(2);

    expect(auth.verifyToken(token1)).toBeNull();
    expect(auth.verifyToken(token2)).toBeNull();

    const meAfter = await app!.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: bearerHeaders(token1),
    });
    expect(meAfter.statusCode).toBe(401);

    const revokedAgain = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: bearerHeaders(token2),
    });
    expect(revokedAgain.statusCode).toBe(401);

    const remaining = db.prepare(
      "SELECT count(*) as c FROM sessions WHERE user_id = ? AND surface IN ('web','miniapp')",
    ).get(OWNER_ID) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('L6g: viewer is forbidden from revoking sessions', async () => {
    await boot();
    if (!db) throw new Error('not booted');
    const viewerToken = mintBoundSession(db, VIEWER_ID, VIEWER_TELEGRAM_ID, 'web');
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: bearerHeaders(viewerToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('L6g: missing auth returns 401', async () => {
    await boot();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: { host: CANONICAL_HOST, origin: CANONICAL_ORIGIN },
    });
    expect(res.statusCode).toBe(401);
  });

  it('L6g: host not allowed returns 403', async () => {
    await boot();
    if (!db) throw new Error('not booted');
    const ownerToken = mintBoundSession(db, OWNER_ID, OWNER_TELEGRAM_ID, 'web');
    const res = await app!.inject({
      method: 'POST',
      url: '/api/xmachines/sessions/revoke-all',
      headers: bearerHeaders(ownerToken, { host: 'evil.example.com' }),
    });
    expect(res.statusCode).toBe(403);
  });
});
