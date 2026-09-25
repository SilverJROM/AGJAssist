// Authored per slice A1 — app-side fail-closed busy preflight with hard timeout.
// Specimens are scratch fixtures. The ssh double and xmac.sh spy are the second path.
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
const LOCAL_OWNER = 'a1-owner-token';
const MACHINE = 'gpu';
const FIXTURE_IP = '192.0.2.50';
const FIXTURE_TARGET = 'agjrom@192.0.2.50';

type Scenario = 'timeout' | 'error-empty' | 'unreachable' | 'busy' | 'idle';

const SSH_FAKE = `#!/bin/bash
set -u
log=\${A1_SSH_ARGV_LOG:?A1_SSH_ARGV_LOG is required}
{
  printf '%s' "$(date -u +%FT%TZ)"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$log"
scenario_file=\${A1_SSH_SCENARIO_FILE:?A1_SSH_SCENARIO_FILE is required}
scenario=$(tr -d '[:space:]' < "$scenario_file")
case "$scenario" in
  timeout)
    ppid=$PPID
    deadline=$((SECONDS + 30))
    while [ "$SECONDS" -lt "$deadline" ]; do
      if ! kill -0 "$ppid" 2>/dev/null; then
        exit 0
      fi
      sleep 0.2
    done
    exit 0
    ;;
  error-empty)
    exit 1
    ;;
  unreachable)
    exit 255
    ;;
  busy)
    printf '%s\\n' 'gpu-process-busy'
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
    authService: { verifyToken: (t: string) => t === LOCAL_OWNER ? { id: 1, role: 'owner', username: 'owner' } : null } as ApiServices['authService'],
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

function spyArgv(log: string): string[][] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').slice(1));
}

function sshTargets(log: string): string[] {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t').slice(1).join(' '));
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

describe('xmachines busy preflight — fail-closed before OFF gateway', () => {
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
    'A1_SSH_ARGV_LOG',
    'A1_SSH_SCENARIO_FILE',
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

  async function boot(scenario: Scenario): Promise<{ spyLog: string; sshLog: string }> {
    prev = {};
    for (const key of ENV_KEYS) prev[key] = process.env[key];
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-busy-'));
    const bin = path.join(scratch, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(SPY, path.join(bin, 'xmac.sh'));
    const ssh = path.join(bin, 'ssh');
    fs.writeFileSync(ssh, SSH_FAKE, { mode: 0o755 });
    fs.chmodSync(ssh, 0o755);
    const spyLog = path.join(scratch, 'spy.log');
    const sshLog = path.join(scratch, 'ssh.log');
    const scenarioFile = path.join(scratch, 'scenario');
    fs.writeFileSync(scenarioFile, `${scenario}\n`);
    const conf = path.join(scratch, 'machines.conf');
    fs.writeFileSync(
      conf,
      `${MACHINE}|${FIXTURE_IP}|02:00:00:00:00:50|agjrom|fixture|echo fixture-busy-check\n`,
    );
    process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
    process.env.XMAC_ARGV_SPY_LOG = spyLog;
    delete process.env.XMAC_ARGV_SPY_REAL;
    process.env.XMACHINES_ARM = '1';
    process.env.XMAC_CONF = conf;
    process.env.XMAC_USER = 'agjrom';
    process.env.A1_SSH_ARGV_LOG = sshLog;
    process.env.A1_SSH_SCENARIO_FILE = scenarioFile;
    delete process.env.XMACHINES_PROTECTED_FIXTURE_DIR;
    app = await createApiServer(minimalConfig(), stubServices());
    return { spyLog, sshLog };
  }

  function off(key: string) {
    return app!.inject({
      method: 'POST',
      url: `/api/xmachines/machines/${MACHINE}/power/off`,
      headers: ownerHeaders({ 'idempotency-key': key }),
    });
  }

  async function expectRefusal(spyLog: string, sshLog: string, key: string, phrase: boolean) {
    const res = await off(key);
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; detail?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('cannot-confirm-idle');
    if (phrase) expect(body.detail).toContain('cannot confirm idle');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(spyArgv(spyLog)).toEqual([]);
    expect(sshTargets(sshLog).join('\n')).toContain(FIXTURE_TARGET);
  }

  it('L1a preflight runs before OFF — busy stdout refuses and the gateway spy stays empty', async () => {
    const { spyLog, sshLog } = await boot('busy');
    await expectRefusal(spyLog, sshLog, 'a1-l1a-busy', false);
  });

  it('L1b timeout is BUSY and refuses OFF with cannot confirm idle', async () => {
    const { spyLog, sshLog } = await boot('timeout');
    await expectRefusal(spyLog, sshLog, 'a1-l1b-timeout', true);
  }, 20_000);

  it('L1c error-empty output is BUSY and refuses OFF with cannot confirm idle', async () => {
    const { spyLog, sshLog } = await boot('error-empty');
    await expectRefusal(spyLog, sshLog, 'a1-l1c-error-empty', true);
  });

  it('L1d unreachable SSH is BUSY and refuses OFF with cannot confirm idle', async () => {
    const { spyLog, sshLog } = await boot('unreachable');
    await expectRefusal(spyLog, sshLog, 'a1-l1d-unreachable', true);
  });

  it('L1e fail-closed refusal returns cannot confirm idle', async () => {
    const { spyLog, sshLog } = await boot('error-empty');
    const res = await off('a1-l1e-phrase');
    expect(res.statusCode).toBe(400);
    const body = res.json() as { status?: string; reason?: string; detail?: string };
    expect(body.status).toBe('rejected');
    expect(body.reason).toBe('cannot-confirm-idle');
    expect(body.detail).toContain('cannot confirm idle');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(spyArgv(spyLog)).toEqual([]);
    expect(sshTargets(sshLog).join('\n')).toContain(FIXTURE_TARGET);
  });

  it('idle control — rc 0 and empty stdout returns 202 and exactly one down argv', async () => {
    const { spyLog, sshLog } = await boot('idle');
    const res = await off('a1-idle-control');
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status?: string };
    expect(body.status).toBe('in-progress');
    expect(await waitForArgv(spyLog, 1)).toEqual([['down', MACHINE, '--owner-off']]);
    expect(sshTargets(sshLog).join('\n')).toContain(FIXTURE_TARGET);
  });
});
