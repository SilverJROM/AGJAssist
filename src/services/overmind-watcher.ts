import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  OvermindChildSessionStatus,
  OvermindService,
  OvermindWorkflow,
  OvermindWorkflowStatus
} from "./overmind-service.js";
import { TmuxService } from "../tmux/tmux-service.js";
import {
  DEFAULT_COMPLETION_CONSULT_TEXT,
  OvermindBrain,
  RegistrationReviewVerdict,
  hasAlwaysEscalateKeyword
} from "./overmind-brain.js";
import { AppSettingsService } from "./app-settings-service.js";
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

import type { ClassifyWorkflowInput, ClassifyParentSessionInput } from "./overmind/classifier.js";
import {
  allTasksComplete,
  classifyWorkflow,
  classifyParentSession,
  classifyChildSessionStatus
} from "./overmind/classifier.js";
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
import { EvidenceReader } from "./overmind/evidence-reader.js";
import { cleanupWorkflowState } from "./overmind/workflow-cleanup.js";
import {
  applyDecisionInterception,
  applyNudgeLadder
} from "./overmind/nudge-ladder.js";
import { handleAllTasksDone } from "./overmind/completion-detector.js";

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
  private readonly evidenceReader: EvidenceReader;

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
  ) {
    this.evidenceReader = new EvidenceReader({
      overmindService: this.overmindService,
      cooldowns: this.cooldowns,
      appSettings: this.appSettings
    });
  }

  async tick(): Promise<void> {
    const allWorkflows = this.overmindService.list();
    const activeWorkflows = allWorkflows.filter(
      (workflow) => !TERMINAL_STATUSES.includes(workflow.status)
    );

    // Clean up staleness state for any workflow that just became terminal/paused.
    for (const workflow of allWorkflows) {
      if (TERMINAL_STATUSES.includes(workflow.status)) {
        cleanupWorkflowState(workflow.id, {
          cooldowns: this.cooldowns,
          nudgeState: this.nudgeState,
          childPaneHashes: this.childPaneHashes,
          lastReconcileAsk: this.lastReconcileAsk,
          subagentInFlight: this.subagentInFlight,
          apparentIdleSince: this.apparentIdleSince,
          evidenceReader: this.evidenceReader
        });
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

    const paneChanged = workflow.last_pane_hash !== null && result.coordinatorHash !== workflow.last_pane_hash;
    const evidence = await this.evidenceReader.readAndPromote(
      workflow,
      coordinatorPane,
      resolvedRunDir,
      paneChanged
    );
    workflow = evidence.workflow;
    const derivedTaskState = evidence.derivedTaskState;

    // Monitoring paused (JROM is talking to this coordinator): keep the display live
    // (status, parent/child, attribution) so overmind stays AWARE, but suppress every
    // interrupt — no completion consult, no completeness request, no nudge, no brain,
    // no notification. Resume re-arms everything on the next tick.
    if (workflow.monitoring_paused) {
      cleanupWorkflowState(workflow.id, {
        cooldowns: this.cooldowns,
        nudgeState: this.nudgeState,
        childPaneHashes: this.childPaneHashes,
        lastReconcileAsk: this.lastReconcileAsk,
        subagentInFlight: this.subagentInFlight,
        apparentIdleSince: this.apparentIdleSince,
        evidenceReader: this.evidenceReader
      });
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
      await handleAllTasksDone(
        workflow,
        coordinatorPane,
        result.coordinatorHash,
        activeAttribution,
        parentStatus,
        childStatuses,
        resolvedRunDir,
        {
          overmindService: this.overmindService,
          tmuxService: this.tmuxService,
          brain: this.brain
        }
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
        ? await applyDecisionInterception(workflow, result.pendingDecision, {
          overmindService: this.overmindService,
          tmuxService: this.tmuxService,
          brain: this.brain,
          appSettings: this.appSettings,
          nudgeState: this.nudgeState,
          cooldowns: this.cooldowns,
          notify: this.notify
        })
        : await applyNudgeLadder(workflow, result.status, coordinatorPane, {
          overmindService: this.overmindService,
          tmuxService: this.tmuxService,
          brain: this.brain,
          appSettings: this.appSettings,
          nudgeState: this.nudgeState,
          cooldowns: this.cooldowns,
          notify: this.notify
        });

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

// isDecisionPrompt + capturePendingDecision moved to ./overmind/classifier.ts (B4)

// isPastStuckThreshold moved to ./overmind/classifier.ts (B4)

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}
