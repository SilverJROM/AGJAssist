import path from "node:path";
import { stat } from "node:fs/promises";
import type { AppSettingsService } from "../app-settings-service.js";
import { DEFAULT_EVIDENCE_IDLE_THRESHOLD_MIN } from "../app-settings-service.js";
import type { NudgeStateService } from "../nudge-state-service.js";
import type { OvermindWorkflow, OvermindWorkflowStatus } from "../overmind-service.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { WatcherCooldowns } from "./cooldowns.js";

export interface IdleDetectorDeps {
  tmuxService: TmuxService;
  cooldowns: WatcherCooldowns;
  appSettings?: AppSettingsService;
  nudgeState?: NudgeStateService;
  TERMINAL_STATUSES: OvermindWorkflowStatus[];
}

export async function maybeAskForParentUpdate(
  workflow: OvermindWorkflow,
  resolvedRunDir: string,
  deps: IdleDetectorDeps
): Promise<void> {
  if (workflow.monitoring_paused || deps.TERMINAL_STATUSES.includes(workflow.status)) {
    return;
  }

  const parentApiMs = workflow.last_parent_update_at
    ? Date.parse(workflow.last_parent_update_at)
    : NaN;
  const progressMtimeMs = await fileMtimeMsBestEffort(
    path.join(resolvedRunDir, "progress.md")
  );
  const callbacksMtimeMs = await fileMtimeMsBestEffort(
    path.join(resolvedRunDir, "callbacks.md")
  );
  const lastActivityMs = Math.max(
    Number.isFinite(parentApiMs) ? parentApiMs : 0,
    progressMtimeMs,
    callbacksMtimeMs
  );
  if (lastActivityMs === 0) return;

  const nowMs = Date.now();
  const cooldownMs = effectiveEvidenceIdleThresholdMs(workflow, deps.appSettings);
  if (nowMs - lastActivityMs <= cooldownMs) return;

  const lastNudgeAt =
    deps.nudgeState?.getLastAskUpdateNudge(workflow.id) ??
    deps.cooldowns.getLastFired(workflow.id, "ask_update");
  if (nowMs - lastNudgeAt < cooldownMs) return;

  const staleMinutes = Math.max(1, Math.round((nowMs - lastActivityMs) / 60_000));
  const message =
    `Overmind: I haven't seen any activity in ~${staleMinutes} minutes — ` +
    "no progress.md / callbacks.md updates, no task-state changes. Are you still working? " +
    "Please update progress.md (or callbacks.md) with current status and I'll read it from there. " +
    "If the run is finished, POST /api/overmind/complete to close it out.";
  try {
    await deps.tmuxService.sendAndSubmit(workflow.coordinator_session, message);
    deps.cooldowns.recordFired(workflow.id, "ask_update", nowMs);
    deps.nudgeState?.setLastAskUpdateNudge(workflow.id, nowMs);
  } catch (error) {
    console.error("Overmind ask-update nudge failed:", error);
  }
}

async function fileMtimeMsBestEffort(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

function effectiveEvidenceIdleThresholdMs(
  workflow: OvermindWorkflow,
  appSettings?: AppSettingsService
): number {
  const overrideMin = workflow.evidence_idle_threshold_override_minutes;
  const systemMin =
    appSettings?.get().evidence_idle_threshold_minutes ?? DEFAULT_EVIDENCE_IDLE_THRESHOLD_MIN;
  return (overrideMin ?? systemMin) * 60_000;
}
