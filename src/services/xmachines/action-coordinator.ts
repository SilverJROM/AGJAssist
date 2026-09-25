import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProtectedRole } from './protected-roles.js';

export interface ActionRequest {
  machine: string;
  action: 'on' | 'off';
  idempotencyKey: string;
  ownerId: string;
}

export interface ActionResult {
  status: 'in-progress' | 'rejected';
  operationId?: string;
  reason?: 'idempotency-key-required' | 'cooldown' | 'machine-busy' | 'protected-role' | 'cannot-confirm-idle' | 'active-lease';
  role?: string;
  detail?: string;
  /** Same idempotency key rejoined an in-flight operation. Routes strip this before the HTTP body. */
  replayed?: true;
}

interface OngoingAction {
  operationId: string;
  machine: string;
  action: 'on' | 'off';
  idempotencyKey: string;
  ownerId: string;
  startedAt: number;
}

const COOLDOWN_MS = 30_000;

function xmacArgv(action: 'on' | 'off', machine: string): string[] {
  if (action === 'on') return ['up', machine];
  return ['down', machine, '--owner-off'];
}

function xmacStateDir(): string {
  return process.env.XMAC_STATE?.trim() || path.join(os.homedir(), '.xmac');
}

// The real lease source xmac.sh/A13 write to: $XMAC_STATE/leases/<machine>/<holder>.
// Reading it here — rather than trusting the gateway to refuse after being spawned —
// is what keeps the app adapter a genuine no-spawn gate for a machine another agent holds.
function readActiveLeaseNames(machine: string): string[] {
  const dir = path.join(xmacStateDir(), 'leases', machine);
  try {
    return fs.readdirSync(dir).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
}

function readMachinesConf(): Map<string, { ip: string; busyCheck: string }> {
  const home = os.homedir();
  const confPath = process.env.XMAC_CONF ?? path.join(home, '.config/agent-protocols/xmac/machines.conf');
  const map = new Map<string, { ip: string; busyCheck: string }>();
  try {
    const txt = fs.readFileSync(confPath, 'utf8');
    for (const line of txt.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('|');
      if (parts.length < 6) continue;
      const name = parts[0].trim();
      const ip = parts[1].trim();
      const busyCheck = parts.slice(5).join('|').trim();
      map.set(name, { ip, busyCheck });
    }
  } catch {}
  return map;
}

function runBusyCheck(machine: string, busyCheck: string): { ok: boolean; output: string; error: string } {
  if (!busyCheck) return { ok: true, output: '', error: '' };
  const confMap = readMachinesConf();
  const entry = confMap.get(machine);
  if (!entry) return { ok: false, output: '', error: 'no-registry' };
  if (!entry.ip) return { ok: false, output: '', error: 'no-ip' };
  const user = process.env.XMAC_USER ?? 'agjrom';
  const sshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 ${user}@${entry.ip} bash -c '${busyCheck.replace(/'/g, `'\\''`)}'`;
  const start = Date.now();
  const result = spawnSync('bash', ['-c', sshCmd], { timeout: 8000, stdio: 'pipe' });
  const elapsed = Date.now() - start;
  if (result.error) {
    return { ok: false, output: '', error: result.error.message };
  }
  if (result.status === null) {
    return { ok: false, output: '', error: 'timeout' };
  }
  if (result.status !== 0) {
    const out = (result.stdout?.toString() ?? '').trim();
    if (out === '') {
      return { ok: false, output: '', error: 'ssh-error-empty' };
    }
    return { ok: true, output: out, error: '' };
  }
  const out = (result.stdout?.toString() ?? '').trim();
  return { ok: true, output: out, error: '' };
}

export class ActionCoordinator {
  private ongoing = new Map<string, OngoingAction>();
  private idempotency = new Map<string, OngoingAction>();
  private cooldowns = new Map<string, number>();

  handle(request: ActionRequest): ActionResult {
    const idempotencyKey = request.idempotencyKey.trim();
    const { machine, action, ownerId } = request;

    if (!idempotencyKey) {
      return { status: 'rejected', reason: 'idempotency-key-required' };
    }

    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      return { status: 'in-progress', operationId: existing.operationId, replayed: true };
    }

    const cooldownUntil = this.cooldowns.get(machine) ?? 0;
    if (Date.now() < cooldownUntil) {
      return { status: 'rejected', reason: 'cooldown' };
    }

    const inFlight = Array.from(this.ongoing.values()).find((row) => row.machine === machine);
    if (inFlight) {
      if (inFlight.action === action) {
        return { status: 'in-progress', operationId: inFlight.operationId };
      }
      return { status: 'rejected', reason: 'machine-busy' };
    }

    // Protected-role off is refused from the fixture before any argv exists.
    if (action === 'off') {
      const refusal = resolveProtectedRole(machine);
      if (refusal) {
        return {
          status: 'rejected',
          reason: refusal.reason,
          role: refusal.role,
          detail: refusal.detail,
        };
      }
    }

    // App-side fail-closed busy preflight before any OFF gateway call
    if (action === 'off') {
      const confMap = readMachinesConf();
      const entry = confMap.get(machine);
      const busyCheck = entry?.busyCheck ?? '';
      if (busyCheck) {
        const { ok, output, error } = runBusyCheck(machine, busyCheck);
        if (!ok || error === 'timeout' || error === 'ssh-error-empty' || error === 'no-registry' || error === 'no-ip') {
          return { status: 'rejected', reason: 'cannot-confirm-idle', detail: `cannot confirm idle: ${error || 'preflight-failure'}` };
        }
        if (output.length > 0) {
          return { status: 'rejected', reason: 'cannot-confirm-idle', detail: `busy: ${output.slice(0, 200)}` };
        }
      }
    }

    // App-side fail-closed lease refusal, immediately before launch: spawn nothing
    // for a machine another agent is holding, rather than let xmac.sh refuse after
    // the child is already spawned.
    if (action === 'off') {
      const leaseNames = readActiveLeaseNames(machine);
      if (leaseNames.length > 0) {
        return { status: 'rejected', reason: 'active-lease', detail: `active lease: ${leaseNames.join(', ')}` };
      }
    }

    const operationId = randomUUID();
    const ongoing: OngoingAction = {
      operationId,
      machine,
      action,
      idempotencyKey,
      ownerId,
      startedAt: Date.now(),
    };
    this.ongoing.set(operationId, ongoing);
    this.idempotency.set(idempotencyKey, ongoing);

    // Detached child: handle returns before xmac.sh exits.
    void this.launch(action, machine).then(() => {
      const current = this.ongoing.get(operationId);
      if (!current) return;
      this.ongoing.delete(operationId);
      this.idempotency.delete(current.idempotencyKey);
      const until = Date.now() + COOLDOWN_MS;
      this.cooldowns.set(machine, until);
      const timer = setTimeout(() => {
        if (this.cooldowns.get(machine) === until) this.cooldowns.delete(machine);
      }, COOLDOWN_MS);
      timer.unref();
    });

    return { status: 'in-progress', operationId };
  }

  private launch(action: 'on' | 'off', machine: string): Promise<void> {
    const argv = xmacArgv(action, machine);
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const child = spawn('xmac.sh', argv, {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.once('error', done);
      child.once('exit', done);
      child.unref();
    });
  }
}
