import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
  reason?: 'idempotency-key-required' | 'cooldown' | 'machine-busy' | 'protected-role';
  role?: string;
  detail?: string;
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
  return action === 'on' ? ['up', machine] : ['down', machine];
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
      return { status: 'in-progress', operationId: existing.operationId };
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
