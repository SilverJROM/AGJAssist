import path from "node:path";
import { stat } from "node:fs/promises";
import type { AppSettingsService } from "../app-settings-service.js";
import { DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN } from "../app-settings-service.js";
import type { NudgeStateService } from "../nudge-state-service.js";
import type { OvermindWorkflow, OvermindWorkflowStatus } from "../overmind-service.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { WatcherCooldowns } from "./cooldowns.js";

const TRACKED_ARTIFACT_FILES = ["progress.md", "callbacks.md", "queue.md"] as const;

export interface ArtifactFailsafeDeps {
  tmuxService: TmuxService;
  cooldowns: WatcherCooldowns;
  appSettings?: AppSettingsService;
  nudgeState?: NudgeStateService;
  TERMINAL_STATUSES: OvermindWorkflowStatus[];
  subagentInFlight?: boolean;
}

export async function getLastTrackedArtifactActivityMs(runDir: string): Promise<number> {
  const mtimes = await Promise.all(
    TRACKED_ARTIFACT_FILES.map((file) => fileMtimeMsBestEffort(path.join(runDir, file)))
  );
  return Math.max(...mtimes, 0);
}

export function effectiveUnifiedIdleThresholdMs(
  workflow: OvermindWorkflow,
  appSettings?: AppSettingsService
): number {
  const overrideMin = workflow.evidence_idle_threshold_override_minutes;
  const systemMin =
    appSettings?.get().unified_idle_threshold_minutes ?? DEFAULT_UNIFIED_IDLE_THRESHOLD_MIN;
  return (overrideMin ?? systemMin) * 60_000;
}

export async function maybeFireArtifactFailsafe(
  workflow: OvermindWorkflow,
  resolvedRunDir: string,
  deps: ArtifactFailsafeDeps
): Promise<boolean> {
  if (
    workflow.monitoring_paused ||
    deps.subagentInFlight ||
    deps.TERMINAL_STATUSES.includes(workflow.status)
  ) {
    return false;
  }

  const parentApiMs = parseTimestampMs(workflow.last_parent_update_at);
  const artifactMtimeMs = await getLastTrackedArtifactActivityMs(resolvedRunDir);
  const lastActivityMs = Math.max(parentApiMs, artifactMtimeMs);
  if (lastActivityMs === 0) return false;

  const nowMs = Date.now();
  const thresholdMs = effectiveUnifiedIdleThresholdMs(workflow, deps.appSettings);
  if (nowMs - lastActivityMs <= thresholdMs) return false;

  const lastNudgeAt = getLastUnifiedIdleNudgeAt(workflow.id, deps.cooldowns, deps.nudgeState);
  if (nowMs - lastNudgeAt < thresholdMs) return false;

  const staleMinutes = Math.max(1, Math.round((nowMs - lastActivityMs) / 60_000));
  const message =
    `Overmind: no tracked artifact has advanced in ~${staleMinutes} minutes (progress.md / callbacks.md / queue.md).\n` +
    "Are you still working? Update progress.md with current status, or POST /api/overmind/complete if done.";
  try {
    await deps.tmuxService.sendAndSubmit(workflow.coordinator_session, "overmind: " + message);
    deps.cooldowns.recordFired(workflow.id, "unified_idle_nudge", nowMs);
    deps.nudgeState?.setLastUnifiedIdleNudge(workflow.id, nowMs);
    return true;
  } catch (error) {
    console.error("Overmind PATH 3 artifact fail-safe nudge failed:", error);
    return false;
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

function parseTimestampMs(value: string | null): number {
  if (!value) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLastUnifiedIdleNudgeAt(
  workflowId: number,
  cooldowns: WatcherCooldowns,
  nudgeState?: NudgeStateService
): number {
  return Math.max(
    nudgeState?.getLastUnifiedIdleNudge(workflowId) ?? 0,
    cooldowns.getLastFired(workflowId, "unified_idle_nudge"),
    cooldowns.getLastFired(workflowId, "idle_nudge"),
    cooldowns.getLastFired(workflowId, "ask_update"),
    cooldowns.getLastFired(workflowId, "subagent_ask")
  );
}
