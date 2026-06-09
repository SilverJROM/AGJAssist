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
import type { WatcherCooldowns } from "./cooldowns.js";
import { collectPriorDecisions } from "./decision-match.js";
import { sendGuardedParentNudge } from "./parent-nudge-guard.js";

const BRAIN_COORDINATOR_TAIL_LINES = 40;
const BRAIN_RUN_FILE_TAIL_LINES = 80;

/** Max consecutive "working" brain verdicts accepted for an all-done run
 *  without observed pane/artifact activity before falling through to the
 *  completion-prompt ladder. */
const MAX_CONSECUTIVE_WORKING_ACCEPTS = 2;

/** Max completion prompts sent before the ladder stops (run stays visible,
 *  no auto-complete — JROM rule). */
const MAX_COMPLETION_NUDGES = 4;

/** Cooldown key reused from the unified idle path so completion prompts don't
 *  fire immediately after a stuck nudge on the same workflow. */
const COMPLETION_NUDGE_COOLDOWN_KEY = "completion_prompt";

export interface CompletionDetectorDeps {
  overmindService: OvermindService;
  tmuxService: TmuxService;
  brain?: OvermindBrain;
  nudgeState?: NudgeStateService;
  notify?: OvermindNotify;
  /** Required for the bounded completion-prompt ladder cooldown. */
  appSettings?: AppSettingsService;
  /** Required for the cooldown gate on completion prompts. */
  cooldowns?: WatcherCooldowns;
  /** Whether a subagent is currently in flight for this workflow (from watcher). */
  subagentInFlight?: boolean;
  /** Whether the coordinator pane hash changed since the last tick. */
  paneChanged?: boolean;
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

  // ── Orphaned: dead parent → ERROR tab (R5, existing behavior kept) ──────────
  if (isOrphaned) {
    deps.overmindService.update(workflow.id, {
      status: workflow.status === "working" ? "stuck" : workflow.status,
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      // R7: keep stuck_since consistent — set it now if not already set
      stuck_since: workflow.stuck_since ?? new Date().toISOString(),
      completion_check: signature,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: true
    });
    return;
  }

  // ── R1: Cooldown gate (replaces the permanent early-return latch) ────────────
  // If completion_check already equals the current signature, we know a prior tick
  // assessed this run. Re-enter the prompt ladder on a cooldown, rather than
  // returning without action.
  const cooldownMs = (deps.appSettings?.get().stuck_nudge_cooldown_minutes ?? 20) * 60_000;
  const alreadyChecked = workflow.completion_check === signature;
  if (alreadyChecked && deps.cooldowns) {
    const lastFired = deps.cooldowns.getLastFired(workflow.id, COMPLETION_NUDGE_COOLDOWN_KEY);
    const withinCooldown = nowMs - lastFired < cooldownMs;
    if (withinCooldown) {
      // Still within cooldown window — just refresh display fields without nudging.
      deps.overmindService.update(workflow.id, {
        pending_decision: null,
        last_pane_hash: coordinatorHash,
        active_session: attribution.active_session,
        active_role: attribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses,
        orphaned: false
      });
      return;
    }
    // Cooldown elapsed → fall through to re-assess and potentially re-nudge.
  }

  // ── R2: Gate "working" verdict on observed activity ──────────────────────────
  // Accept brain "working" only when real activity is observed; cap consecutive
  // accepts so a genuinely-idle all-done run can't be parked as "working" forever.
  const hasObservedActivity =
    deps.paneChanged === true ||
    deps.subagentInFlight === true;

  if (hasObservedActivity) {
    // Real activity observed → accept "working" without asking the brain.
    // Reset nudge_count/tier so the generic stuck ladder starts fresh if
    // activity stops later. Record cooldown so the next tick doesn't
    // immediately escalate to a completion prompt.
    deps.cooldowns?.recordFired(workflow.id, COMPLETION_NUDGE_COOLDOWN_KEY, nowMs);
    deps.overmindService.update(workflow.id, {
      status: "working",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: null,
      nudge_count: 0,
      tier: 0,
      completion_check: signature,
      completion_nudge_count: 0,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: false
    });
    return;
  }

  // No observed activity → check the brain, but cap consecutive "working" accepts.
  const verdict = await assessCompletion(workflow, coordinatorPane, resolvedRunDir, deps);

  if (verdict.action === "working") {
    // Count how many consecutive times we have accepted "working" without activity.
    // completion_nudge_count is repurposed here as a consecutive-working counter
    // when completion_check is NOT yet set for this signature. Once we enter the
    // nudge ladder we reset it and use it as the nudge counter instead. To avoid
    // ambiguity, we use a separate in-DB mechanism: we track the consecutive-working
    // count by checking how many times we set completion_check=signature without
    // resetting. Rather than adding another column, we use the following heuristic:
    // - If completion_nudge_count > 0 AND completion_check === signature, it means
    //   we already sent nudges, so "working" is no longer credible → fall through.
    // - If completion_check !== signature (first time seeing this signature), allow
    //   up to MAX_CONSECUTIVE_WORKING_ACCEPTS acceptances tracked by a special
    //   negative value range of completion_nudge_count (we use a dedicated bool below).
    //
    // Simpler: we track the consecutive "working" accepts using a field in the
    // cooldowns map (in-memory, lost on restart — acceptable since restart resets
    // the brain too).
    const consecutiveKey = `working_accepts_${signature}`;
    const accepts = (deps.cooldowns?.getLastFired(workflow.id, consecutiveKey) ?? 0);
    // We abuse getLastFired as a counter by storing it as "Date.now() - N" trick.
    // Better: use a separate in-memory counter. Since cooldowns only stores timestamps
    // we need a different approach.
    //
    // We'll use completion_nudge_count with a sign convention:
    // - completion_nudge_count < 0: number of consecutive "working" accepts (negated)
    // - completion_nudge_count >= 0: number of completion nudges sent
    // When completion_check !== signature, reset both.
    const isFirstSignature = workflow.completion_check !== signature;
    const currentAccepts = isFirstSignature ? 0 : (workflow.completion_nudge_count < 0 ? -workflow.completion_nudge_count : 0);

    if (currentAccepts < MAX_CONSECUTIVE_WORKING_ACCEPTS) {
      // Accept this "working" verdict. The consecutive cap itself throttles
      // escalation; we do NOT record the cooldown here so consecutive accepts
      // can accumulate until the cap is hit.
      deps.overmindService.update(workflow.id, {
        status: "working",
        pending_decision: null,
        last_pane_hash: coordinatorHash,
        stuck_since: null,
        nudge_count: 0,
        tier: 0,
        completion_check: signature,
        completion_nudge_count: -(currentAccepts + 1),
        active_session: attribution.active_session,
        active_role: attribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses,
        orphaned: false
      });
      return;
    }
    // Cap exceeded with no activity → fall through to completion prompt ladder.
  }

  // ── R3: Bounded completion-prompt ladder ────────────────────────────────────
  // Determine current nudge count (positive values = completion nudges sent).
  const isFirstSignature = workflow.completion_check !== signature;
  const currentNudgeCount = isFirstSignature
    ? 0
    : Math.max(0, workflow.completion_nudge_count);

  if (currentNudgeCount >= MAX_COMPLETION_NUDGES) {
    // Ladder exhausted — run stays visible, no auto-complete. Keep updating fields.
    deps.overmindService.update(workflow.id, {
      status: "stuck",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? new Date().toISOString(),
      completion_check: signature,
      completion_nudge_count: currentNudgeCount,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: false
    });
    return;
  }

  // Build the proven completion prompt (R3 template from proven-completion-prompt.md).
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
      notify: deps.notify
    },
    (target, text) => deps.tmuxService.sendAndSubmit(target, text)
  );

  if (guarded.sent) {
    // Record cooldown and increment counter.
    deps.cooldowns?.recordFired(workflow.id, COMPLETION_NUDGE_COOLDOWN_KEY, nowMs);
    deps.overmindService.update(workflow.id, {
      status: "stuck",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? new Date().toISOString(),
      completion_check: signature,
      completion_nudge_count: currentNudgeCount + 1,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      orphaned: false
    });
  } else {
    // Parent not reachable (bare-bash / no-session) — sendGuardedParentNudge already
    // called markParentOrphaned internally.
    deps.overmindService.update(workflow.id, {
      status: "stuck",
      pending_decision: null,
      last_pane_hash: coordinatorHash,
      stuck_since: workflow.stuck_since ?? new Date().toISOString(),
      completion_check: signature,
      completion_nudge_count: currentNudgeCount,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: guarded.parent_status ?? parentStatus,
      child_statuses: childStatuses,
      orphaned: false
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
