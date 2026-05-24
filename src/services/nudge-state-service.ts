import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

// ─── Shape ────────────────────────────────────────────────────────────────────
// Keep the key generic so future nudge timestamps (task-stale, parent-idle, etc.)
// can live alongside idle without a schema change.
interface WorkflowNudgeState {
  lastIdleNudgeAt?: number;
  lastAskUpdateNudgeAt?: number;
  lastTaskStaleNudgeAt?: number;
  lastReconcileAsk?: string;
}

interface RegisterAdviceCooldownState {
  lastSentAt?: number;
}

interface NudgeStateFile {
  workflows: Record<string, WorkflowNudgeState>;
  registerAdviceCooldowns?: Record<string, RegisterAdviceCooldownState>;
}

// ─── NudgeStateService ────────────────────────────────────────────────────────
// JSON-backed per-workflow nudge-state persistence.
// Backing file: data/overmind-cooldown-state.json
// Atomic writes: writeFileSync to .tmp then renameSync (survives SIGKILL between ticks).
// In-memory cache avoids disk reads in the hot path.
export class NudgeStateService {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private state: NudgeStateFile = { workflows: {}, registerAdviceCooldowns: {} };

  constructor() {
    this.dataDir = path.resolve(process.cwd(), "data");
    this.stateFile = path.join(this.dataDir, "overmind-cooldown-state.json");
  }

  /** Load persisted state from disk. Call once at startup. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.stateFile, "utf-8");
      try {
        const parsed = JSON.parse(raw) as Partial<NudgeStateFile>;
        this.state = {
          workflows:
            parsed.workflows && typeof parsed.workflows === "object" && !Array.isArray(parsed.workflows)
              ? (parsed.workflows as Record<string, WorkflowNudgeState>)
              : {},
          registerAdviceCooldowns:
            parsed.registerAdviceCooldowns &&
            typeof parsed.registerAdviceCooldowns === "object" &&
            !Array.isArray(parsed.registerAdviceCooldowns)
              ? (parsed.registerAdviceCooldowns as Record<string, RegisterAdviceCooldownState>)
              : {}
        };
      } catch {
        // Malformed JSON — start clean, don't crash.
        console.warn("[NudgeStateService] Malformed JSON in state file — starting with empty state.");
        this.state = { workflows: {}, registerAdviceCooldowns: {} };
      }
    } catch {
      // File missing — start clean (auto-created on first write).
      this.state = { workflows: {}, registerAdviceCooldowns: {} };
    }
  }

  /** Returns the timestamp (ms) of the last idle nudge for a workflow, or 0 if unknown. */
  getLastIdleNudge(workflowId: number): number {
    return this.state.workflows[String(workflowId)]?.lastIdleNudgeAt ?? 0;
  }

  /**
   * Update the last-idle-nudge timestamp for a workflow.
   * Updates the in-memory cache synchronously and atomically writes to disk
   * (write to <file>.tmp then rename — fire-and-forget, non-throwing).
   */
  setLastIdleNudge(workflowId: number, ms: number): void {
    this.upsertWorkflow(workflowId, {
      lastIdleNudgeAt: ms
    });
    this.persistSync();
  }

  getLastAskUpdateNudge(workflowId: number): number {
    return this.state.workflows[String(workflowId)]?.lastAskUpdateNudgeAt ?? 0;
  }

  setLastAskUpdateNudge(workflowId: number, ms: number): void {
    this.upsertWorkflow(workflowId, {
      lastAskUpdateNudgeAt: ms
    });
    this.persistSync();
  }

  getLastTaskStaleNudge(workflowId: number): number {
    return this.state.workflows[String(workflowId)]?.lastTaskStaleNudgeAt ?? 0;
  }

  setLastTaskStaleNudge(workflowId: number, ms: number): void {
    this.upsertWorkflow(workflowId, {
      lastTaskStaleNudgeAt: ms
    });
    this.persistSync();
  }

  getLastReconcileAsk(workflowId: number): string | null {
    return this.state.workflows[String(workflowId)]?.lastReconcileAsk ?? null;
  }

  setLastReconcileAsk(workflowId: number, signature: string | null): void {
    if (signature === null) {
      this.removeWorkflowField(workflowId, "lastReconcileAsk");
      return;
    }
    this.upsertWorkflow(workflowId, {
      lastReconcileAsk: signature
    });
    this.persistSync();
  }

  getRegisterAdviceCooldown(incomingSession: string, targetWorkflowId: number): number {
    const key = this.registerAdviceKey(incomingSession, targetWorkflowId);
    return this.state.registerAdviceCooldowns?.[key]?.lastSentAt ?? 0;
  }

  setRegisterAdviceCooldown(incomingSession: string, targetWorkflowId: number, ms: number): void {
    const key = this.registerAdviceKey(incomingSession, targetWorkflowId);
    const next = this.state.registerAdviceCooldowns ?? {};
    next[key] = { lastSentAt: ms };
    this.state.registerAdviceCooldowns = next;
    this.persistSync();
  }

  /**
   * Remove persisted state for a workflow across every per-workflow map/key.
   * Also removes register-advice cooldown keys targeting this workflow.
   */
  forgetWorkflow(workflowId: number): void {
    const key = String(workflowId);
    let changed = false;
    if (key in this.state.workflows) {
      delete this.state.workflows[key];
      changed = true;
    }
    const adviceKeys = Object.keys(this.state.registerAdviceCooldowns ?? {});
    for (const adviceKey of adviceKeys) {
      if (adviceKey.endsWith(`::${workflowId}`)) {
        delete this.state.registerAdviceCooldowns![adviceKey];
        changed = true;
      }
    }
    if (!changed) return;
    this.persistSync();
  }

  /** Backward-compatible alias. */
  clearWorkflow(workflowId: number): void {
    this.forgetWorkflow(workflowId);
  }

  /** Snapshot used by tests. */
  getStateSnapshot(): NudgeStateFile {
    return JSON.parse(JSON.stringify(this.state)) as NudgeStateFile;
  }

  private upsertWorkflow(workflowId: number, fields: Partial<WorkflowNudgeState>): void {
    const key = String(workflowId);
    this.state.workflows[key] = {
      ...this.state.workflows[key],
      ...fields
    };
  }

  private removeWorkflowField(workflowId: number, field: keyof WorkflowNudgeState): void {
    const key = String(workflowId);
    const row = this.state.workflows[key];
    if (!row || !(field in row)) return;
    delete row[field];
    if (Object.keys(row).length === 0) {
      delete this.state.workflows[key];
    }
    this.persistSync();
  }

  private registerAdviceKey(incomingSession: string, targetWorkflowId: number): string {
    return `${incomingSession}::${targetWorkflowId}`;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /** Atomically persist state to disk (write .tmp → rename). Non-throwing. */
  private persistSync(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync(tmp, this.stateFile);
    } catch (err) {
      console.error("[NudgeStateService] Failed to persist state:", err);
    }
  }
}
