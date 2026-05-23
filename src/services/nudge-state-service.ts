import { writeFileSync, renameSync, mkdirSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

// ─── Shape ────────────────────────────────────────────────────────────────────
// Keep the key generic so future nudge timestamps (task-stale, parent-idle, etc.)
// can live alongside idle without a schema change.
interface WorkflowNudgeState {
  lastIdleNudgeAt?: number;
}

interface NudgeStateFile {
  workflows: Record<string, WorkflowNudgeState>;
}

// ─── NudgeStateService ────────────────────────────────────────────────────────
// JSON-backed per-workflow nudge-state persistence.
// Backing file: data/overmind-cooldown-state.json
// Atomic writes: writeFileSync to .tmp then renameSync (survives SIGKILL between ticks).
// In-memory cache avoids disk reads in the hot path.
export class NudgeStateService {
  private readonly dataDir: string;
  private readonly stateFile: string;
  private state: NudgeStateFile = { workflows: {} };

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
              : {}
        };
      } catch {
        // Malformed JSON — start clean, don't crash.
        console.warn("[NudgeStateService] Malformed JSON in state file — starting with empty state.");
        this.state = { workflows: {} };
      }
    } catch {
      // File missing — start clean (auto-created on first write).
      this.state = { workflows: {} };
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
    const key = String(workflowId);
    this.state.workflows[key] = {
      ...this.state.workflows[key],
      lastIdleNudgeAt: ms
    };
    this.persistSync();
  }

  /**
   * Remove persisted state for a workflow (called on terminal/paused cleanup).
   * Deletes the entry in-memory and persists atomically.
   */
  clearWorkflow(workflowId: number): void {
    const key = String(workflowId);
    if (!(key in this.state.workflows)) return;
    delete this.state.workflows[key];
    this.persistSync();
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
