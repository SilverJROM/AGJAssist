// Authored per slice A2 (attempt 2, correction) — the application owner-Off adapter.
// Gateway-spy: a temp xmac.sh sits first on PATH and records every argv it receives,
// so each specimen proves what the coordinator did or did not spawn, not what it
// returns. The clear-path argv and the zero-spawn counts are literals here, never
// computed from the xmacArgv/lease code under test.
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
const LOCAL_OWNER = 'a2-owner-token';
const MACHINE = 'hdd';
const FIXTURE_IP = '192.0.2.169';
const ARCHIVE_LEASE = 'xmac-claim-hdd-17-transcript-archive';

type BusyScenario = 'idle' | 'busy';

const SSH_FAKE = `#!/bin/bash
set -u
log=\${A2_SSH_ARGV_LOG:?A2_SSH_ARGV_LOG is required}
{
  printf '%s' "$(date -u +%FT%TZ)"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$log"
scenario_file=\${A2_SSH_SCENARIO_FILE:?A2_SSH_SCENARIO_FILE is required}
scenario=$(tr -d '[:space:]' < "$scenario_file")
case "$scenario" in
  busy)
    printf '%s\\n' 'hdd-process-busy'
    exit 0
    ;;
  idle)
    exit 0
    ;;
  *)
    printf 'unknown scenario\\n' >&2
    exit 99
    ;;
esac
`;

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
    authService: { verifyToken: (t: string) => (t === LOCAL_OWNER ? { id: 1, role: 'owner', username: 'owner' } : null) } as ApiServices['authService'],
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

describe('xmachines owner-off adapter — app-side no-spawn gate before xmac.sh', () => {
  let app: FastifyInstance | undefined;
  let scratch: string | undefined;
  let prev: Record<string, string | undefined>;

  const ENV_KEYS = [
    'PATH',
    'XMAC_ARGV_SPY_LOG',
    'XMAC_ARGV_SPY_REAL',
    'XMACHINES_ARM',
    'XMAC_CONF',
    'XMAC_USER',
    'XMAC_STATE',
    'A2_SSH_ARGV_LOG',
    'A2_SSH_SCENARIO_FILE',
    'XMACHINES_PROTECTED_FIXTURE_DIR',
  ] as const;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (prev) {
      for (const key of ENV_KEYS) restoreEnv(key, prev[key]);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  async function boot(busy: BusyScenario): Promise<{ spyLog: string; xmacState: string }> {
    prev = {};
    for (const key of ENV_KEYS) prev[key] = process.env[key];
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-owner-off-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, 'xmac.sh'));
    const ssh = path.join(bin, 'ssh');
    fs.writeFileSync(ssh, SSH_FAKE, { mode: 0o755 });
    fs.chmodSync(ssh, 0o755);
    const spyLog = path.join(scratch, 'spy.log');
    const sshLog = path.join(scratch, 'ssh.log');
    const scenarioFile = path.join(scratch, 'scenario');
    fs.writeFileSync(scenarioFile, `${busy}\n`);
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(conf, `${MACHINE}|${FIXTURE_IP}|02:00:00:00:00:69|agjrom|fixture|pgrep -f xmachines-a2-fixture\n`);
    const xmacState = path.join(scratch, 'xmac-state');
    fs.mkdirSync(xmacState, { recursive: true });
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    delete process.env.XMAC_ARGV_SPY_REAL;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_USER = 'agjrom';
    process.env.XMAC_STATE = xmacState;
    process.env.A2_SSH_ARGV_LOG = sshLog;
    process.env.A2_SSH_SCENARIO_FILE = scenarioFile;
    delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog, xmacState };
  }

  function writeProtectedFixture(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ [MACHINE]: { ip: FIXTURE_IP } }));
    fs.writeFileSync(path.join(dir, 'roles.json'), JSON.stringify({ signal: 'cleared', glimmer: 'cleared' }));
    fs.writeFileSync(path.join(dir, 'leases.json'), JSON.stringify({ names: [] }));
    fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify({ 'transcript-archive': { active: true } }));
  }

  function off(key: string) {
    return app!.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${MACHINE}/power/off`,
      headers: ownerHeaders({ 'idempotency-key': key }),
    });
  }

  it('D2d/L2a clear owner Off records exactly one argv down --owner-off with zero --force', async () => {
    const { spyLog } = await boot('idle');
    const res = await off('a2-clear-off');
    expect(res.statusCode).toBe(202);
    expect((res.json() as { status: string }).status).toBe('in-progress');
    const rows = await waitForArgv(spyLog, 1);
    expect(rows).toEqual([['down', MACHINE, '--owner-off']]);
    expect(rows.flat()).not.toContain('--force');
  });

  it('L2c busy preflight refuses owner Off and spawns nothing', async () => {
    const { spyLog } = await boot('busy');
    const res = await off('a2-busy-refusal');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status: string; reason?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('cannot-confirm-idle');
    await expectNoSpawn(spyLog);
  });

  it('D2d protected-role refusal (hdd transcript-archive window) refuses owner Off and spawns nothing', async () => {
    const { spyLog } = await boot('idle');
    writeProtectedFixture(path.join(scratch!, 'protected-fixture'));
    process.env.XMACHINES_PROTECTED_FIXTURE_DIR = path.join(scratch!, 'protected-fixture');
    const res = await off('a2-protected-role-refusal');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status: string; reason?: string; role?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('protected-role');
    expect(body.role).toBe('transcript-archive');
    await expectNoSpawn(spyLog);
  });

  it('L2b an active ~/.xmac lease (the hdd archive claim) refuses owner Off and spawns nothing', async () => {
    const { spyLog, xmacState } = await boot('idle');
    const leaseDir = path.join(xmacState, 'leases', MACHINE);
    fs.mkdirSync(leaseDir, { recursive: true });
    fs.writeFileSync(path.join(leaseDir, ARCHIVE_LEASE), '');
    const res = await off('a2-active-lease-refusal');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status: string; reason?: string; detail?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('active-lease');
    expect(body.detail).toContain(ARCHIVE_LEASE);
    await expectNoSpawn(spyLog);
  });

  it('L2b an ordinary active lease (unrelated holder name) also refuses owner Off and spawns nothing', async () => {
    const { spyLog, xmacState } = await boot('idle');
    const leaseDir = path.join(xmacState, 'leases', MACHINE);
    fs.mkdirSync(leaseDir, { recursive: true });
    fs.writeFileSync(path.join(leaseDir, 'some-other-agent-session'), '');
    const res = await off('a2-ordinary-lease-refusal');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status: string; reason?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('active-lease');
    await expectNoSpawn(spyLog);
  });

  it('L2d a guard-3 style refusal is never rewritten into --force in the emitted argv', async () => {
    const { spyLog } = await boot('busy');
    await off('a2-l2d-no-force');
    await expectNoSpawn(spyLog);
    expect(fs.existsSync(spyLog) ? fs.readFileSync(spyLog, 'utf8') : '').not.toContain('--force');
  });
});
