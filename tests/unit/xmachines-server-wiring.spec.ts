import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApiServer, type ApiServices } from '../../src/api/server.js';
import { AppConfig } from '../../src/config/config.js';
import { DatabaseService } from '../../src/db/database.js';
import { resolveXmachinesRuntime } from '../../src/services/xmachines/runtime.js';
import { sampleFleet } from '../../src/services/xmachines/sampler.js';
import { ReadOnlyCollector } from '../../src/services/xmachines/readonly-collector.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  const db = new DatabaseService(':memory:');
  return {
    authService: {
      verifyToken: () => ({ id: 1, role: 'owner', username: 'owner' }),
    } as ApiServices['authService'],
    projectService: {} as ApiServices['projectService'],
    safetyService: {} as ApiServices['safetyService'],
    auditService: { log: () => {} } as ApiServices['auditService'],
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
    coordinatorLaunchService: {} as ApiServices['coordinatorLaunchService'],
    agentEventsStreamManager: {} as ApiServices['agentEventsStreamManager'],
    telegramAssistant: null,
  };
}

describe('xmachines-server-wiring', () => {
  let app: FastifyInstance | undefined;
  let prevArm: string | undefined;

  beforeEach(async () => {
    prevArm = process.env.XMACHINES_ARM;
    delete process.env.XMACHINES_ARM;
    app = await createApiServer(minimalConfig(), stubServices());
  });

  afterEach(async () => {
    await app?.close();
    if (prevArm !== undefined) process.env.XMACHINES_ARM = prevArm;
    else delete process.env.XMACHINES_ARM;
  });

  it('F2a — server sampler runs with no browser session present', () => {
    const runtime = resolveXmachinesRuntime({ XMACHINES_ARM: '0' });
    expect(runtime.telemetry).toBeInstanceOf(ReadOnlyCollector);
    const fleet = sampleFleet({ XMACHINES_ARM: '0' });
    expect(Array.isArray(fleet)).toBe(true);
    expect(fleet.length).toBeGreaterThan(0);
    const rows = fs.readFileSync(path.join(REPO, 'src/services/xmachines/sampler.ts'), 'utf8');
    expect(rows).toContain('resolveXmachinesRuntime');
    expect(rows).toContain('telemetry.generate');
  });

  it('F2b — server sampler schedules on a 10-minute cadence', () => {
    const src = fs.readFileSync(path.join(REPO, 'src/index.ts'), 'utf8');
    const tenMin = src.includes('10 * 60 * 1000') || src.includes('600000') || /setInterval\s*\([^,]+,\s*10\s*\*\s*60\s*\*\s*1000/.test(src);
    expect(tenMin).toBe(true);
    const mentionsSampler = src.includes('sampleFleet') || src.includes('ReadOnlyCollector') || src.includes('xmachines');
    expect(mentionsSampler).toBe(true);
  });

  it('K1d — no new app process, port, tunnel or deploy target exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts).not.toHaveProperty('xmachines-server');
    const devFiles = fs.readdirSync(REPO, { withFileTypes: true }).filter(f => f.isFile()).map(f => f.name);
    const hasNewListener = devFiles.some(n => n.toLowerCase().includes('xmachines-server') && n.endsWith('.js'));
    expect(hasNewListener).toBe(false);
    const serverSrc = fs.readFileSync(path.join(REPO, 'src/index.ts'), 'utf8');
    expect(serverSrc).not.toMatch(/listen.*xmachines/);
  });
});
