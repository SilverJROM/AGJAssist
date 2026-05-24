import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  OvermindChildSessionStatus,
  OvermindParentStatus,
  OvermindService,
  OvermindWorkflow,
  OvermindWorkflowStatus
} from "./overmind-service.js";
import { TmuxService } from "../tmux/tmux-service.js";
import {
  BrainVerdict,
  CompletionVerdict,
  DecisionVerdict,
  DEFAULT_COMPLETION_CONSULT_TEXT,
  OvermindBrain,
  RegistrationReviewVerdict,
  hasAlwaysEscalateKeyword
} from "./overmind-brain.js";
import {
  buildBlockedNotification,
  buildNeedsInputNotification
} from "./overmind-notifications.js";
import {
  AppSettingsService,
  DEFAULT_EVIDENCE_READ_CADENCE_MIN,
  DEFAULT_IDLE_NUDGE_COOLDOWN_MIN
} from "./app-settings-service.js";
import { NudgeStateService } from "./nudge-state-service.js";

export const POLL_MS = 30_000;
export const RECONCILE_MS = 1_800_000;
// STUCK_THRESHOLD_MS owned by ./overmind/classifier.ts (B4 + B9). Imported below.
// Sub-modules live under ./overmind/ — see each import below for which file owns what.

import {
  SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS,
  SUBAGENT_REASK_GRACE_MS,
  SUBAGENT_DURATION_GRACE_MS,
  subAgentInFlight,
  paneShowsSubagentDone,
  parseSubagentAckFromPane
} from "./overmind/subagent-detection.js";
export const CAPTURE_LINES = 200;
export const MAX_CANNED_NUDGES = 2;
export const BRAIN_COORDINATOR_TAIL_LINES = 40;
export const BRAIN_RUN_FILE_TAIL_LINES = 80;
export const DECISION_HANDLED_TIER = 4;
import {
  applyAlwaysEscalateGuardrail,
  collectPriorDecisions,
  checkedContextLine
} from "./overmind/decision-match.js";
export const CANNED_NUDGE =
  "Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS.";
// Used when the workflow has no child sessions registered — probes for an unregistered
// child rather than asking the parent to check callbacks.
export const CANNED_NUDGE_NO_CHILD =
  "Overmind: you appear idle — are you actually idle, or do you have an unregistered child session? If you spawned one, please register it (POST /api/overmind/register with the updated child_sessions + child_roles). Otherwise resume work or report STATUS.";
// Deterministic fallback consult text when the Sonnet completion brain is unavailable.
export const ALL_DONE_CONFIRM_NUDGE = DEFAULT_COMPLETION_CONSULT_TEXT;
export const FRONTLOAD_CORRECTION_NOTE =
  "Overmind: that decision should have been frontloaded at intake (projcore §1.4a) — please put such decisions in the north-star next time.";

// Floor cadence for progress.md/callbacks.md reads; mtime change triggers immediate re-read.
// Settings-overridable via `evidence_read_cadence_minutes` (default 3).
export const EVIDENCE_READ_CADENCE_MS = 3 * 60 * 1000;
import { STUCK_THRESHOLD_MS } from "./overmind/classifier.js";

const RUN_DIR_ACTIVITY_FILES = ["callbacks.md", "progress.md", "queue.md"] as const;
const TERMINAL_STATUSES: OvermindWorkflowStatus[] = ["paused", "completed", "failed"];

export type OvermindNotify = (text: string) => Promise<void>;
export type OvermindUpdate = (workflows: OvermindWorkflow[]) => void | Promise<void>;

import type {
  ClassifyWorkflowInput,
  ClassifyResult,
  ClassifyParentSessionInput
} from "./overmind/classifier.js";
import {
  allTasksComplete,
  classifyWorkflow,
  classifyParentSession,
  classifyChildSessionStatus,
  deriveTaskStateFromText
} from "./overmind/classifier.js";
import type { ActiveSessionAttribution } from "./overmind/active-session-attribution.js";

interface NudgeLadderFields {
  nudge_count: number;
  tier: number;
  status?: OvermindWorkflowStatus;
  last_pane_hash?: string;
  stuck_since?: string | null;
  pending_decision?: string | null;
}

class CooldownTimestampStore {
  constructor(
    private readonly cooldowns: WatcherCooldowns,
    private readonly key: string
  ) {}

  get(workflowId: number): number | undefined {
    const lastFired = this.cooldowns.getLastFired(workflowId, this.key);
    return lastFired === 0 ? undefined : lastFired;
  }

  set(workflowId: number, timestampMs: number): this {
    this.cooldowns.recordFired(workflowId, this.key, timestampMs);
    return this;
  }

  has(workflowId: number): boolean {
    return this.cooldowns.getLastFired(workflowId, this.key) !== 0;
  }

  delete(workflowId: number): boolean {
    const hadValue = this.has(workflowId);
    this.cooldowns.forgetKey(workflowId, this.key);
    return hadValue;
  }
}

import { hashPane, hasActiveTurn } from "./overmind/pane-utils.js";
import { determineActiveSessionAttribution } from "./overmind/active-session-attribution.js";
import { assessRegistrationCompleteness } from "./overmind/completeness.js";
import type { CompletenessResult } from "./overmind/completeness.js";
import { WatcherCooldowns } from "./overmind/cooldowns.js";
import { maybeAskForParentUpdate } from "./overmind/idle-detector.js";

export class OvermindWatcher {
  private interval: NodeJS.Timeout | null = null;
  private readonly childPaneHashes = new Map<number, Map<string, string>>();
  private lastReconcileAt = 0;
  // Per-workflow dedupe: workflowId → gap signature last asked. Prevents re-asking the
  // same unchanged gap every 30-min cycle. Cleared when the gap resolves so a fresh
  // recurrence triggers a new ask.
  private readonly lastReconcileAsk = new Map<number, string>();
  private readonly cooldowns = new WatcherCooldowns();
  private readonly lastTaskStaleCheckAt = new CooldownTimestampStore(this.cooldowns, "evidence_read");
  private readonly lastSubagentAskAt = new CooldownTimestampStore(this.cooldowns, "subagent_ask");
  private readonly lastIdleNudgeAt = new CooldownTimestampStore(this.cooldowns, "idle_nudge");
  private readonly lastAskUpdateNudgeAt = new CooldownTimestampStore(this.cooldowns, "ask_update");
  // Task-staleness detector state — per workflow, keyed by workflow.id
  private readonly lastProgressMtimeMs = new Map<number, number>();

  // ── In-process sub-agent suppression state ────────────────────────────────
  // subagentInFlight: when set for a workflow, all parent-facing interrupts are suppressed.
  // Intentionally in-memory: this is short-lived live-session attribution derived
  // from current pane text each tick; restart-loss self-heals on next capture.
  private readonly subagentInFlight = new Map<
    number,
    { source: "tui" | "ack"; since: number; name?: string; expectedEndAt?: number }
  >();
  // Intentionally in-memory: this is a per-tick debounce marker used to decide
  // when to ask once about possible in-process sub-agents; restart-loss only
  // resets that debounce window and does not corrupt durable workflow state.
  // First timestamp at which "parent not-working AND every child idle/closed" was observed.
  private readonly apparentIdleSince = new Map<number, number>();
  constructor(
    private readonly overmindService: OvermindService,
    private readonly tmuxService: TmuxService,
    private readonly notify?: OvermindNotify,
    private readonly brain?: OvermindBrain,
    private readonly onUpdate?: OvermindUpdate,
    private readonly appSettings?: AppSettingsService,
    private readonly nudgeState?: NudgeStateService
  ) {}

  async tick(): Promise<void> {
    const allWorkflows = this.overmindService.list();
    const activeWorkflows = allWorkflows.filter(
      (workflow) => !TERMINAL_STATUSES.includes(workflow.status)
    );

    // Clean up staleness state for any workflow that just became terminal/paused.
    for (const workflow of allWorkflows) {
      if (TERMINAL_STATUSES.includes(workflow.status)) {
        this.cleanupStalenessState(workflow.id);
      }
    }

    await Promise.all(activeWorkflows.map((workflow) => this.tickWorkflow(workflow)));

    if (Date.now() - this.lastReconcileAt >= RECONCILE_MS) {
      await this.reconcile(activeWorkflows);
      this.lastReconcileAt = Date.now();
    }

    await this.onUpdate?.(this.overmindService.list());
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.tick();
    }, POLL_MS);
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  // 30-min reconcile: for each active, non-paused workflow that has an unresolved gap
  // (info_request is set), check whether the parent session is still alive. If it is,
  // send a single consolidated demand asking the parent to re-register its current roster
  // and confirm status — bundling the task-list update reminder into the SAME message.
  //
  // Dedupe: a gap is asked ONCE per distinct signature (info_check ?? info_request).
  // The same unchanged gap is NOT re-asked on subsequent 30-min cycles. A changed gap
  // signature triggers a new ask. When the gap clears (info_request null) or the workflow
  // becomes terminal/paused, the entry is removed so a fresh recurrence asks again.
  // Best-effort: never throws.
  async reconcile(workflows: OvermindWorkflow[]): Promise<void> {
    for (const workflow of workflows) {
      // Gap resolved or terminal/paused — clear the dedupe entry so a future recurrence asks.
      if (!workflow.info_request || workflow.monitoring_paused) {
        this.lastReconcileAsk.delete(workflow.id);
        this.nudgeState?.setLastReconcileAsk(workflow.id, null);
        if (workflow.monitoring_paused) continue;
        continue;
      }

      // Sub-agent in flight: skip reconcile sends (parent is legitimately working).
      if (this.subagentInFlight.has(workflow.id)) continue;

      try {
        const parentAlive = await this.sessionExistsSafe(workflow.coordinator_session);
        if (!parentAlive) continue;

        // Compute the gap signature: prefer info_check (richer, already encodes the gap set);
        // fall back to info_request if info_check is not yet populated.
        const gapSignature = workflow.info_check ?? workflow.info_request;

        // Same gap as last ask — do not nag again.
        const lastAskedSignature =
          this.nudgeState?.getLastReconcileAsk(workflow.id) ??
          this.lastReconcileAsk.get(workflow.id) ??
          null;
        if (lastAskedSignature === gapSignature) continue;

        const problemDesc = workflow.info_request;
        const msg =
          `Overmind: registration gap detected (${problemDesc}) — please re-register your CURRENT child_sessions, child_roles, and status to overmind now (POST /api/overmind/register), ` +
          `and update your task list (POST /api/overmind/tasks) if it has changed since you last reported.`;
        await this.tmuxService.sendAndSubmit(workflow.coordinator_session, msg);

        // Record the signature we just asked so future cycles with the same gap skip.
        this.lastReconcileAsk.set(workflow.id, gapSignature);
        this.nudgeState?.setLastReconcileAsk(workflow.id, gapSignature);
      } catch (error) {
        console.error(`Overmind reconcile failed for workflow ${workflow.id}:`, error);
      }
    }
  }

  private async tickWorkflow(workflow: OvermindWorkflow): Promise<void> {
    const now = new Date().toISOString();
    // Resolve run_dir to an absolute path first: projcore may register it relative to the
    // COORDINATOR's cwd, not ours. Resolving against the coordinator pane's cwd avoids a
    // false "run_dir not found" and keeps the run_dir mtime activity signal working.
    const resolvedRunDir = await this.resolveRunDir(workflow);
    const [coordinatorPane, childSnapshots, mtimeAdvanced, runDirExists, coordinatorSessionExists] = await Promise.all([
      this.capturePaneSafe(workflow.coordinator_session),
      Promise.all(workflow.child_sessions.map((target) => this.captureChildSession(target))),
      runDirMtimeAdvanced(resolvedRunDir, workflow.last_activity_at),
      pathExists(resolvedRunDir),
      this.sessionExistsSafe(workflow.coordinator_session)
    ]);
    const childPanes = childSnapshots.map((child) => child.pane);
    const childHashChanges = this.updateChildPaneHashes(
      workflow.id,
      childSnapshots,
      workflow.last_pane_hash === null
    );
    const childStatuses = childSnapshots.map(({ session, pane, exists }) => ({
      session,
      status: classifyChildSessionStatus({
        pane,
        exists,
        paneHashChanged: childHashChanges.get(session) === true
      })
    }));
    const parentStatus = classifyParentSession({
      coordinatorPane,
      coordinatorHashPrev: workflow.last_pane_hash,
      stuckSincePrev: workflow.stuck_since,
      now
    });

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes,
      childPaneHashChanged: Array.from(childHashChanges.values()).some(Boolean),
      coordinatorHashPrev: workflow.last_pane_hash,
      mtimeAdvanced,
      stuckSincePrev: workflow.stuck_since,
      now
    });
    const activeAttribution = determineActiveSessionAttribution({
      coordinatorSession: workflow.coordinator_session,
      coordinatorPane,
      childSessions: workflow.child_sessions,
      childPanes
    });

    // Task-staleness derivation (best-effort, never throws out of tick).
    const paneChanged = workflow.last_pane_hash !== null && result.coordinatorHash !== workflow.last_pane_hash;
    let derivedTaskState: Record<string, "done" | "in-progress" | "unknown"> | undefined;
    try {
      derivedTaskState = await this.assessTaskStaleness(workflow, coordinatorPane, resolvedRunDir, paneChanged);
    } catch {
      derivedTaskState = undefined;
    }

    // JROM 2026-05-24 lazy-supervisor fix — auto-promote tasks where the
    // derivation says "done" but the registered state isn't. Silent, audit
    // trail in task_log via source='evidence-derived'. After this step the
    // registered state matches the derivation, so the tasks_stale gap in
    // completeness.ts has nothing left to flag (and is now removed).
    if (derivedTaskState && workflow.tasks?.length) {
      const promotedTasks = workflow.tasks.map((t) =>
        t.id && t.state !== "done" && derivedTaskState[t.id] === "done"
          ? { ...t, state: "done" as const }
          : t
      );
      const changedAny = promotedTasks.some((t, i) => t.state !== workflow.tasks[i].state);
      if (changedAny) {
        const refreshed = this.overmindService.setTasks(
          workflow.id,
          workflow.current_task,
          promotedTasks,
          "evidence-derived"
        );
        if (refreshed) {
          // Re-read so the rest of this tick (applyCompleteness, nudge ladder)
          // sees the post-promotion state, not the stale snapshot.
          workflow = refreshed;
        }
      }
    }

    // Monitoring paused (JROM is talking to this coordinator): keep the display live
    // (status, parent/child, attribution) so overmind stays AWARE, but suppress every
    // interrupt — no completion consult, no completeness request, no nudge, no brain,
    // no notification. Resume re-arms everything on the next tick.
    if (workflow.monitoring_paused) {
      this.cleanupStalenessState(workflow.id);
      this.overmindService.update(workflow.id, {
        status: result.status,
        pending_decision: result.pendingDecision,
        last_pane_hash: result.coordinatorHash,
        stuck_since: result.stuckSince,
        active_session: activeAttribution.active_session,
        active_role: activeAttribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses,
        ...(result.lastActivityAt ? { last_activity_at: result.lastActivityAt } : {})
      });
      return;
    }

    await maybeAskForParentUpdate(workflow, resolvedRunDir, {
      tmuxService: this.tmuxService,
      cooldowns: this.cooldowns,
      appSettings: this.appSettings,
      nudgeState: this.nudgeState,
      TERMINAL_STATUSES
    });

    // ── In-process sub-agent detection + suppression (Tier-1/2/3) ─────────────
    const nowMs = Date.now();
    const wid = workflow.id;

    // Detect parent ack from pane text first (runs regardless of current state).
    // An explicit named marker is richer than TUI inference; process it before Tier-1
    // so it always wins when the pane contains both a TUI indicator and an ack marker.
    const ackMatch = parseSubagentAckFromPane(coordinatorPane);
    if (ackMatch && !this.subagentInFlight.has(wid)) {
      // Only set on first detection to avoid repeated overwrites on subsequent ticks.
      const expectedEndAt = ackMatch.expectedMinutes
        ? nowMs + ackMatch.expectedMinutes * 60_000
        : undefined;
      this.subagentInFlight.set(wid, {
        source: "ack",
        since: nowMs,
        name: ackMatch.name,
        expectedEndAt
      });
      this.apparentIdleSince.delete(wid);
    }

    // Tier-1: TUI inference — detect sub-agent indicator in the pane.
    if (subAgentInFlight(coordinatorPane)) {
      const existing = this.subagentInFlight.get(wid);
      if (!existing || existing.source !== "ack") {
        // Set/refresh with TUI source; don't overwrite a richer "ack" entry.
        this.subagentInFlight.set(wid, { source: "tui", since: nowMs });
      }
    }

    // Tier-3 resolution — run regardless of how the entry got set.
    const saEntry = this.subagentInFlight.get(wid);
    if (saEntry) {
      if (paneShowsSubagentDone(coordinatorPane)) {
        this.subagentInFlight.delete(wid);
      } else if (
        saEntry.source === "tui" &&
        !subAgentInFlight(coordinatorPane) &&
        workflow.last_pane_hash !== null &&
        result.coordinatorHash !== workflow.last_pane_hash
      ) {
        // Indicator gone AND pane has substantive change since entry was set.
        this.subagentInFlight.delete(wid);
      } else if (
        saEntry.expectedEndAt &&
        nowMs > saEntry.expectedEndAt + SUBAGENT_DURATION_GRACE_MS
      ) {
        // Expected duration + grace elapsed.
        this.subagentInFlight.delete(wid);
        this.cooldowns.forgetKey(wid, "subagent_ask");
      }
    }

    // Tier-2 ask trigger — only when no suppression entry is active.
    const currentSaEntry = this.subagentInFlight.get(wid);
    if (!currentSaEntry) {
      // "Apparent idle": parent is not working AND every registered child is idle/closed.
      const parentNotWorking = parentStatus !== "working";
      const allChildrenQuiet = childStatuses.every(
        (c) => c.status === "idle" || c.status === "closed"
      );
      const apparentIdle = parentNotWorking && allChildrenQuiet;

      if (apparentIdle) {
        if (!this.apparentIdleSince.has(wid)) {
          this.apparentIdleSince.set(wid, nowMs);
        }
      } else {
        this.apparentIdleSince.delete(wid);
      }

      const idleSince = this.apparentIdleSince.get(wid);
      if (
        idleSince !== undefined &&
        nowMs - idleSince > SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS &&
        this.cooldowns.shouldFire(wid, "subagent_ask", SUBAGENT_REASK_GRACE_MS, nowMs)
      ) {
        try {
          await this.tmuxService.sendAndSubmit(
            workflow.coordinator_session,
            "Overmind: you appear idle but no child session is working — are you running an in-process sub-agent? " +
            "If yes, reply with: [OVERMIND] subagent <name> ~<N>min (and I'll stop nudging until you return). " +
            "Otherwise resume work or report STATUS."
          );
        } catch (err) {
          console.error("Overmind sub-agent ask failed:", err);
        }
        this.cooldowns.recordFired(wid, "subagent_ask", nowMs);
      }
    }

    // SUPPRESSION: if a sub-agent is in flight, skip all parent-facing sends this tick
    // and force status to "working" so the dashboard doesn't show "stuck".
    if (this.subagentInFlight.has(wid)) {
      this.overmindService.update(workflow.id, {
        status: "working",
        pending_decision: result.pendingDecision,
        last_pane_hash: result.coordinatorHash,
        stuck_since: null,
        active_session: activeAttribution.active_session,
        active_role: activeAttribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses,
        ...(result.lastActivityAt ? { last_activity_at: result.lastActivityAt } : {})
      });
      return;
    }

    // Edge case (the lkvc-38 situation): the task list shows every task done but the
    // coordinator never reported /complete. A clean /complete is trusted and never lands
    // here — this branch ONLY guards the unreported all-done state. Sonnet verifies it
    // ONCE per distinct all-done signature (token-gated via completion_check), then
    // consults projcore — projcore's own /complete remains where the buck stops.
    if (allTasksComplete(workflow.tasks)) {
      await this.handleAllTasksDone(
        workflow,
        coordinatorPane,
        result.coordinatorHash,
        activeAttribution,
        parentStatus,
        childStatuses,
        resolvedRunDir
      );
      return;
    }

    // Registration/data completeness (the hardening layer): deterministic gap detection
    // that asks the COORDINATOR (projcore) for missing pieces, ~90% without Sonnet. When
    // a request is sent this tick we own the pane hash and skip the status nudge so we
    // never double-type into the coordinator in one tick.
    // tasks_stale gap is suppressed (omitted from derivedTaskState) while a sub-agent is
    // in flight. Since we already returned above for the suppressed case, reaching here
    // means no sub-agent in flight — pass derivedTaskState as-is.
    const info = await this.applyCompleteness(workflow, {
      childStatuses,
      runDirExists,
      coordinatorSessionExists,
      resolvedRunDir,
      now,
      derivedTaskState
    });

    const nudgeFields = info.requestedThisTick
      ? { nudge_count: workflow.nudge_count, tier: workflow.tier }
      : result.status === "awaiting_decision"
        ? await this.applyDecisionInterception(workflow, result.pendingDecision)
        : await this.applyNudgeLadder(workflow, result.status, coordinatorPane);

    this.overmindService.update(workflow.id, {
      status: nudgeFields.status ?? result.status,
      pending_decision: nudgeFields.pending_decision !== undefined
        ? nudgeFields.pending_decision
        : result.pendingDecision,
      last_pane_hash: info.last_pane_hash ?? nudgeFields.last_pane_hash ?? result.coordinatorHash,
      stuck_since: nudgeFields.stuck_since !== undefined ? nudgeFields.stuck_since : result.stuckSince,
      active_session: activeAttribution.active_session,
      active_role: activeAttribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses,
      info_request: info.info_request,
      info_check: info.info_check,
      ...nudgeFields,
      ...(result.lastActivityAt ? { last_activity_at: result.lastActivityAt } : {})
    });
  }

  // Resolve a workflow's run_dir to an absolute path. Absolute paths pass through. A
  // relative path is resolved against the coordinator pane's cwd (projcore registers it
  // relative to ITS working dir, not overmind's). Falls back to the raw value if the
  // coordinator cwd is unknown — then a genuinely-bad path is still flagged.
  private async resolveRunDir(workflow: OvermindWorkflow): Promise<string> {
    if (path.isAbsolute(workflow.run_dir)) return workflow.run_dir;
    const cwd = await this.tmuxService.paneCurrentPath?.(workflow.coordinator_session);
    return cwd ? path.resolve(cwd, workflow.run_dir) : workflow.run_dir;
  }

  // Deterministic-first registration completeness. Clears the badge when complete; asks
  // once per distinct gap signature (info_check dedupe); routes the present-but-contradictory
  // case to Sonnet (reviewRegistration) which can request, dismiss, or rarely escalate.
  private async applyCompleteness(
    workflow: OvermindWorkflow,
    ctx: {
      childStatuses: OvermindChildSessionStatus[];
      runDirExists: boolean;
      coordinatorSessionExists: boolean;
      resolvedRunDir: string;
      now: string;
      derivedTaskState?: Record<string, "done" | "in-progress" | "unknown">;
    }
  ): Promise<{
    info_request: string | null;
    info_check: string | null;
    last_pane_hash?: string;
    requestedThisTick: boolean;
  }> {
    const ageMs = Math.max(
      0,
      new Date(ctx.now).getTime() - new Date(workflow.run_started_at ?? workflow.created_at).getTime()
    );
    const assessment = assessRegistrationCompleteness({
      tasks: workflow.tasks ?? [],
      childSessions: workflow.child_sessions ?? [],
      childRoles: workflow.child_roles ?? [],
      childStatuses: ctx.childStatuses,
      coordinatorSession: workflow.coordinator_session,
      coordinatorSessionExists: ctx.coordinatorSessionExists,
      runDir: workflow.run_dir,
      runDirExists: ctx.runDirExists,
      ageMs,
      currentTask: workflow.current_task,
      runStartedAt: workflow.run_started_at ?? null,
      taskLogLastAt: workflow.task_log?.[workflow.task_log.length - 1]?.at ?? null,
      nowMs: new Date(ctx.now).getTime(),
      derivedTaskState: ctx.derivedTaskState
    });

    // Complete — clear any outstanding badge/signature.
    if (assessment.missing.length === 0) {
      return { info_request: null, info_check: null, requestedThisTick: false };
    }

    // Same gap set already handled — hold the badge, do not re-ask (token/pane safe).
    if (workflow.info_check === assessment.signature) {
      return { info_request: workflow.info_request, info_check: workflow.info_check, requestedThisTick: false };
    }

    // New gap set. Deterministic by default; Sonnet only for the contradictory case.
    let requestText = assessment.requestText;
    const requestLabel = assessment.requestLabel;
    // JROM v2.2: reviewRegistration Sonnet path REMOVED. The deterministic
    // assessment is final — `needsBrain` is dead in the new pure-algorithm
    // world (task_mismatch silently ignored; dashboard's current_task field
    // already surfaces it to the human, no token-spend brain consult needed).

    if (!requestText) {
      return { info_request: requestLabel, info_check: assessment.signature, requestedThisTick: false };
    }

    let lastPaneHash: string | undefined;
    try {
      await this.tmuxService.sendAndSubmit(workflow.coordinator_session, requestText);
      lastPaneHash = hashPane(await this.capturePaneSafe(workflow.coordinator_session));
    } catch (error) {
      console.error("Overmind completeness request failed:", error);
    }

    return {
      info_request: requestLabel,
      info_check: assessment.signature,
      last_pane_hash: lastPaneHash,
      requestedThisTick: true
    };
  }

  private async handleAllTasksDone(
    workflow: OvermindWorkflow,
    coordinatorPane: string,
    coordinatorHash: string,
    attribution: ActiveSessionAttribution,
    parentStatus: OvermindParentStatus,
    childStatuses: OvermindChildSessionStatus[],
    resolvedRunDir: string
  ): Promise<void> {
    const doneCount = workflow.tasks.filter((task) => task.state === "done").length;
    const signature = `${doneCount}/${workflow.tasks.length}`;

    // Already assessed this exact all-done state — hold quietly: no Sonnet, no nudge
    // ladder, no token spend. Re-armed only when the task list changes (new signature)
    // or projcore re-registers (completion_check reset to NULL).
    if (workflow.completion_check === signature) {
      this.overmindService.update(workflow.id, {
        pending_decision: null,
        last_pane_hash: coordinatorHash,
        stuck_since: null,
        nudge_count: 0,
        tier: 0,
        active_session: attribution.active_session,
        active_role: attribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses
      });
      return;
    }

    const verdict = await this.assessCompletion(workflow, coordinatorPane, resolvedRunDir);

    if (verdict.action === "working") {
      // False alarm — Sonnet sees the run is still active despite the all-done list.
      this.overmindService.update(workflow.id, {
        status: "working",
        pending_decision: null,
        last_pane_hash: coordinatorHash,
        stuck_since: null,
        nudge_count: 0,
        tier: 0,
        completion_check: signature,
        active_session: attribution.active_session,
        active_role: attribution.active_role,
        parent_status: parentStatus,
        child_statuses: childStatuses
      });
      return;
    }

    // consult: ask projcore to confirm + POST /complete (or clarify what remains).
    let lastPaneHash = coordinatorHash;
    try {
      await this.tmuxService.sendAndSubmit(workflow.coordinator_session, verdict.consultText!);
      lastPaneHash = hashPane(await this.capturePaneSafe(workflow.coordinator_session));
    } catch (error) {
      console.error("Overmind completion consult nudge failed:", error);
    }

    this.overmindService.update(workflow.id, {
      status: "waiting_human",
      pending_decision: null,
      last_pane_hash: lastPaneHash,
      stuck_since: null,
      nudge_count: 0,
      tier: 0,
      completion_check: signature,
      active_session: attribution.active_session,
      active_role: attribution.active_role,
      parent_status: parentStatus,
      child_statuses: childStatuses
    });
  }

  private async assessCompletion(
    workflow: OvermindWorkflow,
    coordinatorPane: string,
    resolvedRunDir: string
  ): Promise<CompletionVerdict> {
    if (!this.brain?.verifyCompletion) {
      return {
        action: "consult",
        consultText: ALL_DONE_CONFIRM_NUDGE,
        reason: "No completion brain available; deterministic consult to projcore."
      };
    }
    const tasksSummary = summarizeTasks(workflow.tasks);
    try {
      return await this.brain.verifyCompletion({
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
        consultText: ALL_DONE_CONFIRM_NUDGE,
        reason: "Completion brain failed; deterministic consult to projcore."
      };
    }
  }

  private async applyNudgeLadder(
    workflow: OvermindWorkflow,
    status: ClassifyResult["status"],
    coordinatorPane: string
  ): Promise<NudgeLadderFields> {
    if (status === "working") {
      return { nudge_count: 0, tier: 0 };
    }

    if (status === "waiting_human") {
      if (!this.brain || workflow.tier >= 3) {
        return { nudge_count: workflow.nudge_count, tier: workflow.tier };
      }
      return this.applyTier3Brain(workflow, coordinatorPane);
    }

    if (status !== "stuck") {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }

    if (workflow.nudge_count >= MAX_CANNED_NUDGES) {
      if (!this.brain || workflow.tier >= 3) {
        return { nudge_count: workflow.nudge_count, tier: workflow.tier };
      }
      return this.applyTier3Brain(workflow, coordinatorPane);
    }

    if (workflow.tier >= 3) {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }

    // ── Idle-nudge cooldown ──────────────────────────────────────────────────
    // Flat rate-limit: if appSettings is injected and the last canned idle nudge was sent
    // less than idle_nudge_cooldown_minutes ago, skip this tick entirely.
    // When appSettings is not provided (e.g. in unit tests without injection) the cooldown
    // is not applied and the ladder runs at full speed — preserving backward compatibility.
    if (this.appSettings) {
      const idleCooldownMs = this.appSettings.get().idle_nudge_cooldown_minutes * 60_000;
      const nowMs = Date.now();
      // Prefer persisted timestamp (survives restarts); fall back to in-memory for tests
      // that don't inject nudgeState.
      const lastIdleNudge =
        this.nudgeState?.getLastIdleNudge(workflow.id) ??
        this.cooldowns.getLastFired(workflow.id, "idle_nudge");
      if (nowMs - lastIdleNudge < idleCooldownMs) {
        // Still in cooldown — return current state unchanged (no increment, no send).
        return { nudge_count: workflow.nudge_count, tier: workflow.tier };
      }
    }

    const nextNudgeCount = workflow.nudge_count + 1;
    // No-child workflows can be legitimately registered without children. In that case
    // the nudge probes for an unregistered child instead of asking about callbacks.
    const nudgeText = (workflow.child_sessions?.length ?? 0) === 0 ? CANNED_NUDGE_NO_CHILD : CANNED_NUDGE;
    await this.tmuxService.sendAndSubmit(workflow.coordinator_session, nudgeText);
    // Record the send time AFTER successful sendAndSubmit — both in-memory (for tests
    // that don't inject nudgeState) and in the persisted store (survives restarts).
    const sendTs = Date.now();
    this.cooldowns.recordFired(workflow.id, "idle_nudge", sendTs);
    this.nudgeState?.setLastIdleNudge(workflow.id, sendTs);
    const postNudgePane = await this.capturePaneSafe(workflow.coordinator_session);
    return {
      nudge_count: nextNudgeCount,
      tier: nextNudgeCount,
      last_pane_hash: hashPane(postNudgePane)
    };
  }

  private async applyDecisionInterception(
    workflow: OvermindWorkflow,
    pendingDecision: string | null
  ): Promise<NudgeLadderFields> {
    if (!pendingDecision) {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }

    if (workflow.tier >= DECISION_HANDLED_TIER && workflow.pending_decision === pendingDecision) {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }

    let verdict: DecisionVerdict;
    try {
      if (!this.brain) {
        throw new Error("decision brain unavailable");
      }
      verdict = await this.brain.answerDecision({
        label: workflow.label,
        pendingDecision,
        northStar: await readFileBestEffort(path.join(workflow.run_dir, "north-star.md")),
        trustDefaults: await readFileBestEffort(path.join(homedir(), ".claude/JROM/style/trust-defaults.md")),
        priorDecisions: await collectPriorDecisions(workflow.run_dir, `${workflow.label}\n${pendingDecision}`)
      });
    } catch (error) {
      console.error("Overmind decision brain failed:", error);
      verdict = {
        action: "escalate",
        reason: "Decision Sonnet brain failed; escalating to JROM instead of auto-answering."
      };
    }

    const guardedVerdict = applyAlwaysEscalateGuardrail(pendingDecision, verdict);
    await this.logDecisionCorrection(workflow, pendingDecision, guardedVerdict);

    if (guardedVerdict.action === "answer") {
      await this.tmuxService.sendCommand(workflow.coordinator_session, guardedVerdict.answerText!, true, true);
      await this.tmuxService.sendCommand(workflow.coordinator_session, FRONTLOAD_CORRECTION_NOTE, true, true);
      const postDecisionPane = await this.capturePaneSafe(workflow.coordinator_session);
      return {
        nudge_count: workflow.nudge_count,
        tier: DECISION_HANDLED_TIER,
        pending_decision: pendingDecision,
        last_pane_hash: hashPane(postDecisionPane)
      };
    }

    await this.notifyDecisionEscalation(workflow, pendingDecision, guardedVerdict.reason);
    return {
      nudge_count: workflow.nudge_count,
      tier: DECISION_HANDLED_TIER,
      pending_decision: pendingDecision,
      status: "awaiting_decision",
      stuck_since: null
    };
  }

  private async applyTier3Brain(
    workflow: OvermindWorkflow,
    coordinatorPane: string
  ): Promise<NudgeLadderFields> {
    let verdict: BrainVerdict;
    try {
      verdict = await this.brain!.analyzeStuck({
        label: workflow.label,
        coordinatorPaneTail: tailLines(coordinatorPane, BRAIN_COORDINATOR_TAIL_LINES),
        progressTail: await readRunFileTail(workflow.run_dir, "progress.md", BRAIN_RUN_FILE_TAIL_LINES),
        callbacksTail: await readRunFileTail(workflow.run_dir, "callbacks.md", BRAIN_RUN_FILE_TAIL_LINES),
        northStar: await readFileBestEffort(path.join(workflow.run_dir, "north-star.md")),
        trustDefaults: await readFileBestEffort(path.join(homedir(), ".claude/JROM/style/trust-defaults.md")),
        priorDecisions: await collectPriorDecisions(workflow.run_dir, `${workflow.label}\n${coordinatorPane}`)
      });
    } catch (error) {
      console.error("Overmind Tier-3 brain failed:", error);
      verdict = {
        action: "escalate-blocked",
        reason: "Tier-3 Sonnet brain failed; escalating to JROM instead of retrying."
      };
    }

    if (verdict.action === "false-alarm") {
      return { nudge_count: 0, tier: 0, status: "working", stuck_since: null };
    }

    if (verdict.action === "nudge") {
      await this.tmuxService.sendAndSubmit(workflow.coordinator_session, verdict.nudgeText!);
      const postNudgePane = await this.capturePaneSafe(workflow.coordinator_session);
      return {
        nudge_count: workflow.nudge_count,
        tier: 3,
        last_pane_hash: hashPane(postNudgePane)
      };
    }

    await this.notifyBlocked(workflow, tailLines(coordinatorPane, 12), verdict.reason);
    return {
      nudge_count: workflow.nudge_count,
      tier: 3,
      status: "waiting_human",
      stuck_since: null
    };
  }

  // Clean up staleness-detector Maps for a workflow that has gone terminal or paused.
  // Defensive: silently skips if the id isn't present.
  private cleanupStalenessState(workflowId: number): void {
    this.cooldowns.forget(workflowId);
    this.lastProgressMtimeMs.delete(workflowId);
    this.lastReconcileAsk.delete(workflowId);
    // Sub-agent suppression state
    this.subagentInFlight.delete(workflowId);
    this.apparentIdleSince.delete(workflowId);
    this.nudgeState?.forgetWorkflow(workflowId);
  }

  // Async derivation of per-task states from local files + pane text. PURE
  // ALGORITHM — no LLM calls (JROM 2026-05-24 v2.2). Best-effort: returns
  // undefined when nothing parseable found; never throws.
  //
  // Tier 1:  progress.md + callbacks.md regex scan (deterministic).
  // Tier 1b: coordinator pane text (if Tier-1 files yielded nothing, pane >200 chars).
  // (Tier-3 spark/sonnet fallback removed — this loop runs every 3 min × every
  // active workflow, token cost is unbounded for what's fundamentally a regex
  // problem.)
  private async assessTaskStaleness(
    workflow: OvermindWorkflow,
    coordinatorPane: string,
    resolvedRunDir: string,
    paneChanged: boolean
  ): Promise<Record<string, "done" | "in-progress" | "unknown"> | undefined> {
    const now = Date.now();
    const wid = workflow.id;
    const tasks = (workflow.tasks ?? []) as Array<{ id: string; state: string }>;
    if (tasks.length === 0) return undefined;

    // Settings-driven read cadence (default 3 min). The mtime-advanced shortcut
    // still triggers immediate re-reads on any file change; this floor only
    // applies when nothing has changed and we're still polling.
    const settings = this.appSettings?.get();
    const evidenceReadCadenceMs =
      (settings?.evidence_read_cadence_minutes ?? DEFAULT_EVIDENCE_READ_CADENCE_MIN) * 60_000;

    const lastCheck = this.cooldowns.getLastFired(wid, "evidence_read");
    let progressMtime = 0;
    let progressText = "";
    let callbacksText = "";

    try {
      const progressStat = await stat(path.join(resolvedRunDir, "progress.md"));
      progressMtime = progressStat.mtimeMs;
    } catch { /* no file */ }

    const lastKnownMtime = this.lastProgressMtimeMs.get(wid) ?? 0;
    const mtimeAdvanced = progressMtime > lastKnownMtime;
    const checkDue = now - lastCheck >= evidenceReadCadenceMs;

    if (!checkDue && !mtimeAdvanced) return undefined;

    // Read Tier-1 files.
    try {
      progressText = await readFile(path.join(resolvedRunDir, "progress.md"), "utf-8");
    } catch { /* no file */ }
    try {
      callbacksText = await readFile(path.join(resolvedRunDir, "callbacks.md"), "utf-8");
    } catch { /* no file */ }

    // Tier 1: merge derive from both files.
    let derived = new Map<string, "done" | "in-progress" | "unknown">();
    if (progressText) {
      const fromProgress = deriveTaskStateFromText(progressText, tasks);
      for (const [id, state] of fromProgress) derived.set(id, state);
    }
    if (callbacksText) {
      const fromCallbacks = deriveTaskStateFromText(callbacksText, tasks);
      for (const [id, state] of fromCallbacks) {
        // Done takes priority over in-progress; otherwise overwrite.
        const existing = derived.get(id);
        if (existing !== "done") derived.set(id, state);
      }
    }

    // Tier 1b: fallback to pane text when files yielded nothing and pane is substantive.
    if (derived.size === 0 && coordinatorPane.length > 200) {
      derived = deriveTaskStateFromText(coordinatorPane, tasks);
    }

    // JROM 2026-05-24 v2.2: Tier-3 LLM fallback REMOVED. This loop runs every
    // 3 min × every active workflow × forever — token cost is unbounded for
    // what is fundamentally a regex problem. If Tier-1/1b yielded nothing,
    // return undefined; the next tick will retry. Better to miss a derivation
    // than to burn tokens guessing. (The other watcher brain paths —
    // completion consult, decision-match, subagent — fire on rare structural
    // events, not on every poll, and stay.)
    if (derived.size === 0) {
      this.cooldowns.recordFired(wid, "evidence_read", now);
      if (progressMtime > 0) this.lastProgressMtimeMs.set(wid, progressMtime);
      return undefined;
    }

    // Update timestamps.
    this.cooldowns.recordFired(wid, "evidence_read", now);
    if (progressMtime > 0) this.lastProgressMtimeMs.set(wid, progressMtime);

    // Convert Map to plain Record.
    const record: Record<string, "done" | "in-progress" | "unknown"> = {};
    for (const [id, state] of derived) record[id] = state;
    return record;
  }

  async notifyBlocked(workflow: OvermindWorkflow, issue: string, reason: string): Promise<void> {
    await this.notifyTransition(
      workflow,
      `blocked:${hashShort(`${issue}\n${reason}`)}`,
      buildBlockedNotification({
        workflow,
        issue,
        checked: checkedContextLine(),
        reason
      })
    );
  }

  async notifyDecisionEscalation(
    workflow: OvermindWorkflow,
    pendingDecision: string,
    reason: string
  ): Promise<void> {
    await this.notifyTransition(
      workflow,
      `decision:${hashShort(`${pendingDecision}\n${reason}`)}`,
      buildNeedsInputNotification({
        workflow,
        issue: pendingDecision,
        checked: checkedContextLine(),
        reason
      })
    );
  }

  private async logDecisionCorrection(
    workflow: OvermindWorkflow,
    pendingDecision: string,
    verdict: DecisionVerdict
  ): Promise<void> {
    const correctionsDir = path.join(workflow.run_dir, "corrections");
    const correctionFile = path.join(correctionsDir, "overmind-decision-corrections.md");
    const entry = [
      `## ${new Date().toISOString()} — ${workflow.label}`,
      "",
      "Decision:",
      "```",
      pendingDecision,
      "```",
      "",
      `Verdict: ${verdict.action}`,
      `Reason: ${verdict.reason}`,
      "",
      "Correction: this decision should have been frontloaded (§1.4a) in the projcore intake interview / north-star.",
      ""
    ].join("\n");

    try {
      await mkdir(correctionsDir, { recursive: true });
      await appendFile(correctionFile, entry, "utf-8");
    } catch (error) {
      console.error("Overmind decision correction log failed:", error);
    }
  }

  private async notifyBestEffort(text: string): Promise<void> {
    if (!this.notify) return;
    try {
      await this.notify(text);
    } catch (error) {
      console.error("Overmind notify failed:", error);
    }
  }

  private async notifyTransition(workflow: OvermindWorkflow, transition: string, text: string): Promise<void> {
    if (!this.overmindService.markNotificationTransition(workflow.id, transition)) return;
    await this.notifyBestEffort(text);
  }

  private async capturePaneSafe(target: string): Promise<string> {
    try {
      return await this.tmuxService.capturePane(target, CAPTURE_LINES);
    } catch {
      return "";
    }
  }

  private async captureChildSession(
    target: string
  ): Promise<{ session: string; pane: string; exists: boolean }> {
    const exists = await this.sessionExistsSafe(target);
    const pane = exists ? await this.capturePaneSafe(target) : "";
    return {
      session: target,
      pane,
      exists
    };
  }

  private updateChildPaneHashes(
    workflowId: number,
    snapshots: { session: string; pane: string; exists: boolean }[],
    countInitialObservationAsChanged: boolean
  ): Map<string, boolean> {
    const previous = this.childPaneHashes.get(workflowId) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const changes = new Map<string, boolean>();

    for (const snapshot of snapshots) {
      if (!snapshot.exists) {
        changes.set(snapshot.session, false);
        continue;
      }

      const currentHash = hashPane(snapshot.pane);
      const previousHash = previous.get(snapshot.session);
      changes.set(snapshot.session, previousHash === undefined
        ? countInitialObservationAsChanged
        : previousHash !== currentHash);
      next.set(snapshot.session, currentHash);
    }

    this.childPaneHashes.set(workflowId, next);
    return changes;
  }

  private async sessionExistsSafe(target: string): Promise<boolean> {
    try {
      if (typeof this.tmuxService.sessionExists !== "function") return true;
      return await this.tmuxService.sessionExists(target);
    } catch {
      return false;
    }
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function runDirMtimeAdvanced(runDir: string, lastActivityAt: string | null): Promise<boolean> {
  const lastActivityMs = parseTimestamp(lastActivityAt);
  if (lastActivityMs === null) return false;

  const mtimes = await Promise.all(
    RUN_DIR_ACTIVITY_FILES.map(async (file) => {
      try {
        const fileStat = await stat(path.join(runDir, file));
        return fileStat.mtimeMs;
      } catch {
        return 0;
      }
    })
  );

  return Math.max(...mtimes) > lastActivityMs;
}

// applyAlwaysEscalateGuardrail / collectPriorDecisions / extractDecisionTerms /
// selectDecisionSnippet / countOccurrences / checkedContextLine all moved to
// ./overmind/decision-match.ts (B6). Re-exported at top of file.

function hashShort(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// isDecisionPrompt + capturePendingDecision moved to ./overmind/classifier.ts (B4)

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

// isPastStuckThreshold moved to ./overmind/classifier.ts (B4)

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}
