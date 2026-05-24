export class WatcherCooldowns {
  private readonly firedAt = new Map<number, Map<string, number>>();

  shouldFire(workflowId: number, key: string, cooldownMs: number, nowMs = Date.now()): boolean {
    return nowMs - this.getLastFired(workflowId, key) >= cooldownMs;
  }

  recordFired(workflowId: number, key: string, nowMs = Date.now()): void {
    let workflowCooldowns = this.firedAt.get(workflowId);
    if (!workflowCooldowns) {
      workflowCooldowns = new Map<string, number>();
      this.firedAt.set(workflowId, workflowCooldowns);
    }
    workflowCooldowns.set(key, nowMs);
  }

  getLastFired(workflowId: number, key: string): number {
    return this.firedAt.get(workflowId)?.get(key) ?? 0;
  }

  forget(workflowId: number): void {
    this.firedAt.delete(workflowId);
  }
}
