import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { AppSettingsService } from "../app-settings-service.js";
import { DEFAULT_EVIDENCE_READ_CADENCE_MIN } from "../app-settings-service.js";
import type { OvermindService, OvermindWorkflow } from "../overmind-service.js";
import { deriveTaskStateFromText } from "./classifier.js";
import type { WatcherCooldowns } from "./cooldowns.js";

type DerivedTaskState = Record<string, "done" | "in-progress" | "unknown">;

export interface EvidenceReaderDeps {
  overmindService: OvermindService;
  cooldowns: WatcherCooldowns;
  appSettings?: AppSettingsService;
}

export class EvidenceReader {
  private readonly progressMtimeMs = new Map<number, number>();

  constructor(private readonly deps: EvidenceReaderDeps) {}

  async readAndPromote(
    workflow: OvermindWorkflow,
    coordinatorPane: string,
    resolvedRunDir: string,
    paneChanged: boolean
  ): Promise<{ workflow: OvermindWorkflow; derivedTaskState?: DerivedTaskState }> {
    let derivedTaskState: DerivedTaskState | undefined;
    try {
      derivedTaskState = await this.assessTaskStaleness(
        workflow,
        coordinatorPane,
        resolvedRunDir,
        paneChanged
      );
    } catch {
      derivedTaskState = undefined;
    }

    if (derivedTaskState && workflow.tasks?.length) {
      const promotedTasks = workflow.tasks.map((t) =>
        t.id && t.state !== "done" && derivedTaskState[t.id] === "done"
          ? { ...t, state: "done" as const }
          : t
      );
      const changedAny = promotedTasks.some((t, i) => t.state !== workflow.tasks[i].state);
      if (changedAny) {
        const refreshed = this.deps.overmindService.setTasks(
          workflow.id,
          workflow.current_task,
          promotedTasks,
          "evidence-derived"
        );
        if (refreshed) {
          workflow = refreshed;
        }
      }
    }

    return { workflow, derivedTaskState };
  }

  forget(workflowId: number): void {
    this.progressMtimeMs.delete(workflowId);
  }

  private async assessTaskStaleness(
    workflow: OvermindWorkflow,
    coordinatorPane: string,
    resolvedRunDir: string,
    paneChanged: boolean
  ): Promise<DerivedTaskState | undefined> {
    const now = Date.now();
    const wid = workflow.id;
    const tasks = (workflow.tasks ?? []) as Array<{ id: string; state: string }>;
    if (tasks.length === 0) return undefined;

    const settings = this.deps.appSettings?.get();
    const evidenceReadCadenceMs =
      (settings?.evidence_read_cadence_minutes ?? DEFAULT_EVIDENCE_READ_CADENCE_MIN) * 60_000;

    const lastCheck = this.deps.cooldowns.getLastFired(wid, "evidence_read");
    let progressMtime = 0;
    let progressText = "";
    let callbacksText = "";

    try {
      const progressStat = await stat(path.join(resolvedRunDir, "progress.md"));
      progressMtime = progressStat.mtimeMs;
    } catch { /* no file */ }

    const lastKnownMtime = this.progressMtimeMs.get(wid) ?? 0;
    const mtimeAdvanced = progressMtime > lastKnownMtime;
    const checkDue = now - lastCheck >= evidenceReadCadenceMs;

    if (!checkDue && !mtimeAdvanced) return undefined;

    try {
      progressText = await readFile(path.join(resolvedRunDir, "progress.md"), "utf-8");
    } catch { /* no file */ }
    try {
      callbacksText = await readFile(path.join(resolvedRunDir, "callbacks.md"), "utf-8");
    } catch { /* no file */ }

    let derived = new Map<string, "done" | "in-progress" | "unknown">();
    if (progressText) {
      const fromProgress = deriveTaskStateFromText(progressText, tasks);
      for (const [id, state] of fromProgress) derived.set(id, state);
    }
    if (callbacksText) {
      const fromCallbacks = deriveTaskStateFromText(callbacksText, tasks);
      for (const [id, state] of fromCallbacks) {
        const existing = derived.get(id);
        if (existing !== "done") derived.set(id, state);
      }
    }

    if (derived.size === 0 && coordinatorPane.length > 200) {
      derived = deriveTaskStateFromText(coordinatorPane, tasks);
    }

    if (derived.size === 0) {
      this.deps.cooldowns.recordFired(wid, "evidence_read", now);
      if (progressMtime > 0) this.progressMtimeMs.set(wid, progressMtime);
      return undefined;
    }

    this.deps.cooldowns.recordFired(wid, "evidence_read", now);
    if (progressMtime > 0) this.progressMtimeMs.set(wid, progressMtime);

    const record: DerivedTaskState = {};
    for (const [id, state] of derived) record[id] = state;
    return record;
  }
}
