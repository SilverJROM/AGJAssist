import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type CompletionVerdict,
  type OvermindBrain
} from "../overmind-brain.js";
import type {
  OvermindChildSessionStatus,
  OvermindParentStatus,
  OvermindService,
  OvermindWorkflow
} from "../overmind-service.js";
import type { NudgeStateService } from "../nudge-state-service.js";
import type { OvermindNotify } from "../overmind-watcher.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { ActiveSessionAttribution } from "./active-session-attribution.js";
import type { AppSettingsService } from "../app-settings-service.js";
import { collectPriorDecisions } from "./decision-match.js";
import { sendGuardedParentNudge } from "./parent-nudge-guard.js";

const BRAIN_COORDINATOR_TAIL_LINES = 40;
const BRAIN_RUN_FILE_TAIL_LINES = 80;

/** Max consecutive "working" brain verdicts accepted for an all-done run
 *  without OBSERVED (pane-hash) activity before falling through to the
 *  completion-prompt ladder.
 *  MONOTONIC INVARIANT: once completion_nudge_count > 0, re-entering the
 *  working-accept branch is BLOCKED unless a real pane-hash change is seen. */
const MAX_CONSECUTIVE_WORKING_ACCEPTS = 2;

/** Max completion prompts sent before the slow-backoff phase. */
const MAX_COMPLETION_NUDGES = 4;

/** After MAX_COMPLETION_NUDGES exhaustion, backoff interval before re-nudging (hourly). */
const EXHAUSTION_BACKOFF_MS = 60 * 60_000;

/** Key used for the persisted cooldown in completion_nudge_last_at.
 *  (Also used as legacy key name for in-memory cooldowns map — we now read
 *  completion_nudge_last_at from the DB as the authoritative cooldown.) */
const COMPLETION_NUDGE_COOLDOWN_KEY = "completion_prompt";

/** A stale tui-subagent flag is force-expired after this many ms with no
 *  pane-hash change. Prevents H8: stale tui flag from suppressing the ladder. */
const STALE_SUBAGENT_FORCE_EXPIRE_MS = 5 * 60_000;

export interface CompletionDetectorDeps {
  overmindService: OvermindService;
  tmuxService: TmuxService;
  brain?: OvermindBrain;
  nudgeState?: NudgeStateService;
  notify?: OvermindNotify;
  /** Required for the bounded completion-prompt ladder cooldown. */
  appSettings?: AppSettingsService;
  /** Whether a subagent is currently in flight for this workflow (from watcher). */
  subagentInFlight?: boolean;
  /** Whether the coordinator pane hash changed since the last tick. */
  paneChanged?: boolean;
  /** Timestamp (ms) when the subagent entry was first set. Used for H8 force-expiry. */
  subagentInFlightSince?: number;
  /** Whether the subagent entry came from a tui-source detection (vs ack). */
  subagentInFlightSource?: "tui" | "ack";
  /** Called to clear stale subagent flag externally (H8). */
  clearSubagentInFlight?: () => void;
  liveResolver?: (stored: string) => Promise<string>;
}

/**
 * Builds the PROVEN completion prompt text (template from proven-completion-prompt.md).
 * OVM NEVER completes — it sends this and the parent runs the command.
 */
export function buildCompletionPrompt(
  label: string,
  doneCount: number,
  totalCount: number,
  runDir: string
): string {
  return (
    `overmind: This is Overmind (your run supervisor). Your run "${label}" shows all ${doneCount}/${totalCount} tasks DONE but is` +
    ` still listed as ACTIVE on the dashboard, because Overmind never received a completion signal — finishing` +
    ` the work isn't enough, I need you to explicitly mark the run complete. If this run is genuinely finished,` +
    ` run this command now to close it out:  bash ~/.claude/agents/lib/overmind.sh complete --run-dir ${runDir}` +
    `  — then reply "completed" so I can confirm it cleared. If there is actually remaining work, ignore this and` +
    ` update your task list instead.`
  );
}

export async function handleAllTasksDone(
  workflow: OvermindWorkflow,
  coordinatorPane: string,
  coordinatorHash: string,
  attribution: ActiveSessionAttribution,
  parentStatus: OvermindParentStatus,
  childStatuses: OvermindChildSessionStatus[],
  isOrphaned: boolean,
  resolvedRunDir: string,
  deps: CompletionDetectorDeps
): Promise<void> {
  const doneCount = workflow.tasks.filter((task) => task.state === "done").length;
  const totalCount = workflow.tasks.length;
  const signature = `${doneCount}/${totalCount}`;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // ── Orphaned: dead parent → ERROR tab (R5, existing behavior kept) ──────────
  if (isOrphaned) {
    deps.overmindService.update(workflow.id, {
      status: workflow.status === "working" ? "stuck" : workflow.status,
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? nowIso,
      completion_check: signature,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: true
    });
    return;
  }

  // ── H8: Force-expire a stale tui-source subagentInFlight flag ────────────────
  // If the subagent entry is tui-sourced and there has been no pane-hash change
  // within STALE_SUBAGENT_FORCE_EXPIRE_MS, do NOT treat it as activity. Clear it
  // so the completion ladder proceeds. A stale tui flag must never suppress the
  // all-done path forever.
  if (
    deps.subagentInFlight === true &&
    deps.subagentInFlightSource === "tui" &&
    !deps.paneChanged &&
    deps.subagentInFlightSince !== undefined &&
    nowMs - deps.subagentInFlightSince >= STALE_SUBAGENT_FORCE_EXPIRE_MS
  ) {
    deps.clearSubagentInFlight?.();
    // Fall through — subagentInFlight is now treated as false for this path.
  }

  // Re-read the flag (may have been cleared above).
  // We shadow the dep so the rest of the function uses the updated value.
  const effectiveSubagentInFlight =
    deps.subagentInFlight === true &&
    !(
      deps.subagentInFlightSource === "tui" &&
      !deps.paneChanged &&
      deps.subagentInFlightSince !== undefined &&
      nowMs - deps.subagentInFlightSince >= STALE_SUBAGENT_FORCE_EXPIRE_MS
    );

  // ── Observed activity check ──────────────────────────────────────────────────
  // REAL activity = coordinator pane hash actually changed (since last tick) OR
  // a live (non-stale-tui) subagent is in flight.
  // H8: a tui-source subagentInFlight WITHOUT a recent pane-hash change is NOT
  // treated as observed activity — it is considered stale.
  const hasObservedActivity =
    (deps.paneChanged === true) ||
    (effectiveSubagentInFlight === true);

  // ── MONOTONIC INVARIANT ──────────────────────────────────────────────────────
  // Once completion_nudge_count > 0 for this signature, the run CANNOT re-enter
  // working-accept without real observed activity. This prevents oscillation.
  const isSignatureNew = workflow.completion_check !== signature;
  const alreadyNudged = !isSignatureNew && workflow.completion_nudge_count > 0;

  if (hasObservedActivity) {
    // Real activity observed → accept "working". Reset working_accepts (not nudge count).
    // MONOTONIC: nudge count not reset here — only resets on real signature change.
    deps.overmindService.update(workflow.id, {
      status: "working",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: null,
      nudge_count: 0,
      tier: 0,
      completion_check: signature,
      working_accepts: 0,
      // nudge count intentionally NOT reset here (signature unchanged, just activity observed)
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: false
    });
    return;
  }

  // ── H8 / MONOTONIC: if already nudged, skip the working-accept path ──────────
  // A run that already received a completion prompt is NOT credibly "working"
  // again without real activity. Go straight to the cooldown/ladder check.
  if (!alreadyNudged) {
    // No observed activity → check the brain, but cap consecutive "working" accepts.
    const verdict = await assessCompletion(workflow, coordinatorPane, resolvedRunDir, deps);

    if (verdict.action === "working") {
      // Count consecutive "working" accepts for this signature using working_accepts.
      const currentAccepts = isSignatureNew ? 0 : workflow.working_accepts;

      if (currentAccepts < MAX_CONSECUTIVE_WORKING_ACCEPTS) {
        // Accept this "working" verdict.
        deps.overmindService.update(workflow.id, {
          status: "working",
          pending_decision: null,
          last_pane_hash: coordinatorHash,
          stuck_since: null,
          nudge_count: 0,
          tier: 0,
          completion_check: signature,
          working_accepts: currentAccepts + 1,
          // completion_nudge_count NOT touched (stays 0 or unchanged)
          active_session: attribution.active_session,
          active_role: attribution.active_role,
          parent_status: parentStatus,
          child_statuses: childStatuses,
          orphaned: false
        });
        return;
      }
      // Cap exceeded → fall through to completion prompt ladder.
    }
    // verdict !== "working" → fall through to completion prompt ladder.
  }

  // ── Persisted cooldown gate (H3) ─────────────────────────────────────────────
  // Use completion_nudge_last_at from DB as the authoritative cooldown anchor.
  // This survives pm2/process restarts (unlike in-memory WatcherCooldowns).
  const cooldownMs = (deps.appSettings?.get().stuck_nudge_cooldown_minutes ?? 20) * 60_000;
  const lastNudgeMs = parseIsoToMs(workflow.completion_nudge_last_at);
  const currentNudgeCount = isSignatureNew ? 0 : Math.max(0, workflow.completion_nudge_count);

  const withinCooldown = nowMs - lastNudgeMs < cooldownMs;

  // Determine if we're in the exhaustion phase (slow-backoff after MAX nudges).
  const isExhausted = currentNudgeCount >= MAX_COMPLETION_NUDGES;
  const backoffMs = isExhausted ? EXHAUSTION_BACKOFF_MS : cooldownMs;
  const withinBackoff = nowMs - lastNudgeMs < backoffMs;

  if (withinBackoff) {
    // Within cooldown or backoff — just refresh display fields without nudging.
    deps.overmindService.update(workflow.id, {
      status: isExhausted ? "stuck" : (workflow.status === "working" ? "stuck" : workflow.status),
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? nowIso,
      completion_check: signature,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: false
    });
    return;
  }

  // ── H5: Exhaustion → slow-backoff re-nudge + one-shot JROM escalation ───────
  // After MAX_COMPLETION_NUDGES, we continue at hourly backoff and fire ONE
  // deduped escalation notification. NEVER silent-stale-forever.
  if (isExhausted) {
    // Slow-backoff re-nudge (hourly). Send the completion prompt again.
    const completionPrompt = buildCompletionPrompt(
      workflow.label,
      doneCount,
      totalCount,
      resolvedRunDir
    );

    const guarded = await sendGuardedParentNudge(
      workflow,
      completionPrompt,
      {
        overmindService: deps.overmindService,
        nudgeState: deps.nudgeState,
        notify: deps.notify,
        liveResolver: deps.liveResolver
      },
      (target, text) => deps.tmuxService.sendAndSubmit(target, text)
    );

    if (guarded.sent) {
      // Fire ONE-shot JROM escalation notification (deduped via stuck_since check).
      // We escalate on the FIRST hourly re-nudge after exhaustion.
      if (currentNudgeCount === MAX_COMPLETION_NUDGES) {
        try {
          await deps.notify?.(
            `overmind: ⚠️ Run "${workflow.label}" (id=${workflow.id}) has not been completed after ${MAX_COMPLETION_NUDGES} prompts. ` +
            `Switching to hourly slow-backoff reminders. Parent may need manual intervention. ` +
            `Run: bash ~/.claude/agents/lib/overmind.sh complete --run-dir ${resolvedRunDir}`
          );
        } catch {
          // notification failure is non-fatal
        }
      }
      deps.overmindService.update(workflow.id, {
        status: "stuck",
        pending_decision: null,
        last_pane_hash: coordinatorHash,
        stuck_since: workflow.stuck_since ?? nowIso,
        completion_check: signature,
        completion_nudge_count: currentNudgeCount + 1,
        working_accepts: 0,
        completion_nudge_last_at: nowIso,
        active_session: attribution.active_session,
        active_role: attribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses,
        orphaned: false
      });
    } else {
      // F2: send failed → record cooldown + escalate to orphaned (bare-bash parent).
      deps.overmindService.update(workflow.id, {
        status: "stuck",
        pending_decision: null,
        last_pane_hash: coordinatorHash,
        stuck_since: workflow.stuck_since ?? nowIso,
        completion_check: signature,
        completion_nudge_last_at: nowIso,
        active_session: attribution.active_session,
        active_role: attribution.active_role,
        parent_status: guarded.parent_status ?? parentStatus,
        child_statuses: childStatuses,
        orphaned: guarded.paneKind === "bare-bash" || guarded.paneKind === "no-session"
      });
    }
    return;
  }

  // ── R3: Bounded completion-prompt ladder ────────────────────────────────────
  // Build and send the proven completion prompt.
  const completionPrompt = buildCompletionPrompt(
    workflow.label,
    doneCount,
    totalCount,
    resolvedRunDir
  );

  const guarded = await sendGuardedParentNudge(
    workflow,
    completionPrompt,
    {
      overmindService: deps.overmindService,
      nudgeState: deps.nudgeState,
      notify: deps.notify,
      liveResolver: deps.liveResolver
    },
    (target, text) => deps.tmuxService.sendAndSubmit(target, text)
  );

  if (guarded.sent) {
    // MONOTONIC: only increment, never decrement. Record persisted cooldown.
    deps.overmindService.update(workflow.id, {
      status: "stuck",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? nowIso,
      completion_check: signature,
      completion_nudge_count: currentNudgeCount + 1,
      working_accepts: 0,
      completion_nudge_last_at: nowIso,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: false
    });
  } else {
    // F2: bare-bash / no-session → record cooldown timestamp so we don't retry
    // every tick. Escalate to orphaned immediately (bare-bash parent is dead
    // for completion purposes).
    deps.overmindService.update(workflow.id, {
      status: "stuck",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? nowIso,
      completion_check: signature,
      completion_nudge_last_at: nowIso,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: guarded.parent_status ?? parentStatus,
      child_statuses: childStatuses,
      orphaned: guarded.paneKind === "bare-bash" || guarded.paneKind === "no-session"
    });
  }
}

async function assessCompletion(
  workflow: OvermindWorkflow,
  coordinatorPane: string,
  resolvedRunDir: string,
  deps: CompletionDetectorDeps
): Promise<CompletionVerdict> {
  if (!deps.brain?.verifyCompletion) {
    return {
      action: "consult",
      consultText: "",
      reason: "No completion brain available; deterministic consult to projcore."
    };
  }
  const tasksSummary = summarizeTasks(workflow.tasks);
  try {
    return await deps.brain.verifyCompletion({
      label: workflow.label,
      tasksSummary,
      coordinatorPaneTail: tailLines(coordinatorPane, BRAIN_COORDINATOR_TAIL_LINES),
      progressTail: await readRunFileTail(resolvedRunDir, "progress.md", BRAIN_RUN_FILE_TAIL_LINES),
      callbacksTail: await readRunFileTail(resolvedRunDir, "callbacks.md", BRAIN_RUN_FILE_TAIL_LINES),
      northStar: await readFileBestEffort(path.join(resolvedRunDir, "north-star.md")),
      priorDecisions: await collectPriorDecisions(resolvedRunDir, `${workflow.label}\ncompletion ${tasksSummary}`)
    });
  } catch (error) {
    console.error("Overmind completion brain failed:", error);
    return {
      action: "consult",
      consultText: "",
      reason: "Completion brain failed; deterministic consult to projcore."
    };
  }
}

function parseIsoToMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeTasks(tasks: { id: string; label: string; state: string }[]): string {
  if (tasks.length === 0) return "<no tasks>";
  return tasks.map((task) => `- [${task.state}] ${task.id}: ${task.label}`).join("\n").slice(0, 2000);
}

function tailLines(text: string, maxLines: number): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  return lines.slice(-maxLines).join("\n");
}

async function readRunFileTail(runDir: string, file: string, maxLines: number): Promise<string> {
  try {
    return tailLines(await readFile(path.join(runDir, file), "utf-8"), maxLines);
  } catch {
    return "";
  }
}

async function readFileBestEffort(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
