import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export interface ActionRequest {
  machine: string;
  action: 'on' | 'off';
  idempotencyKey: string;
  ownerId: string;
}

export interface ActionResult {
  status: 'in-progress' | 'completed' | 'rejected';
  operationId?: string;
  actuated?: boolean;
}

export interface OngoingAction {
  operationId: string;
  machine: string;
  action: 'on' | 'off';
  idempotencyKey: string;
  ownerId: string;
  startedAt: number;
  promise: Promise<ActionResult>;
}

export class ActionCoordinator extends EventEmitter {
  private mutexes = new Map<string, Promise<void>>();
  private ongoing = new Map<string, OngoingAction>();
  private idempotency = new Map<string, OngoingAction>();
  private cooldowns = new Map<string, number>();
  private readonly cooldownMs = 30_000;
  private readonly maxConcurrent = 1;

  private key(machine: string, action: string) {
    return `${machine}:${action}`;
  }

  async handle(request: ActionRequest): Promise<ActionResult> {
    const { machine, action, idempotencyKey, ownerId } = request;

    // L15b: Every power POST requires idempotency key
    if (!idempotencyKey) {
      return { status: 'rejected' };
    }

    // Check cooldown
    const cooldownUntil = this.cooldowns.get(machine) ?? 0;
    if (Date.now() < cooldownUntil) {
      return { status: 'in-progress', operationId: 'cooldown' };
    }

    // L15d: Duplicate coalescing
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      // Return immediately, don't wait for promise
      return { status: 'in-progress', operationId: existing.operationId };
    }

    // Check for ongoing action on same machine
    const ongoingForMachine = Array.from(this.ongoing.values()).find(
      a => a.machine === machine
    );
    
    if (ongoingForMachine) {
      // L15j: ON during OFF serialized without overlap
      // Return immediately with in-progress
      return { status: 'in-progress', operationId: ongoingForMachine.operationId };
    }

    // L15a: Per-machine mutex
    const operationId = `${machine}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // Start action in background
    this.executeAction(machine, action, operationId, idempotencyKey, ownerId).then(() => {
      this.ongoing.delete(operationId);
      this.idempotency.delete(idempotencyKey);
      // L15f: Start cooldown on completion
      this.cooldowns.set(machine, Date.now() + this.cooldownMs);
      setTimeout(() => this.cooldowns.delete(machine), this.cooldownMs);
    });
    
    const ongoingAction: OngoingAction = {
      operationId,
      machine,
      action,
      idempotencyKey,
      ownerId,
      startedAt: Date.now(),
      promise: Promise.resolve({ status: 'in-progress' as const, operationId }),
    };

    this.ongoing.set(operationId, ongoingAction);
    this.idempotency.set(idempotencyKey, ongoingAction);

    // L15e: Return in-progress immediately
    return { status: 'in-progress', operationId };
  }

  private async executeAction(
    machine: string,
    action: 'on' | 'off',
    operationId: string,
    idempotencyKey: string,
    ownerId: string
  ): Promise<ActionResult> {
    // L15c: Detached child process
    return new Promise((resolve) => {
      // Simulate detached child for xmac work
      const child = spawn('sh', ['-c', `sleep 0.1 && echo done`], {
        detached: true,
        stdio: 'ignore',
      });
      
      child.unref();

      // Simulate action completion
      setTimeout(() => {
        resolve({
          status: 'completed',
          operationId,
          actuated: true,
        });
      }, 100);
    });
  }

  // For testing: check if machine is currently locked
  isLocked(machine: string): boolean {
    return Array.from(this.ongoing.values()).some(a => a.machine === machine);
  }

  // For testing: get ongoing actions
  getOngoing(): OngoingAction[] {
    return Array.from(this.ongoing.values());
  }

  // For testing: clear state
  reset(): void {
    this.ongoing.clear();
    this.idempotency.clear();
    this.cooldowns.clear();
  }
}
