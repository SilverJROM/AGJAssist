import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  OvermindChildSessionStatus,
  OvermindParentStatus,
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
import {
  SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS,
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
  "overmind: Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS. Also check: is your watcher running? Is a ScheduleWakeup set? A missing watcher or wakeup is a common cause of apparent idleness — re-run: PROJCORE_POLL_SECONDS=15 bash ~/.claude/agents/watchers/projcore-watcher.sh <session> <status_file> <issue_id>, and schedule a ScheduleWakeup fallback if not set.";
export const CANNED_NUDGE_NO_CHILD =
  "overmind: Overmind: you appear idle — no child sessions are registered. If this run uses a child, attach it with `overmind.sh child-add <session> <role> --run-dir <run_dir>` or POST /api/overmind/children. Otherwise resume work or report STATUS. Also check: is your watcher running? Is a ScheduleWakeup set? A missing watcher or wakeup is a common cause of apparent idleness — re-run: PROJCORE_POLL_SECONDS=15 bash ~/.claude/agents/watchers/projcore-watcher.sh <session> <status_file> <issue_id>, and schedule a ScheduleWakeup fallback if not set.";
export const ALL_DONE_CONFIRM_NUDGE = "overmind: " + DEFAULT_COMPLETION_CONSULT_TEXT;
export const FRONTLOAD_CORRECTION_NOTE =
  "overmind: Overmind: that decision should have been frontloaded at intake (projcore §1.4a) — please put such decisions in the north-star next time.";
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
import { hashPane, hasActiveTurn } from "./overmind/pane-utils.js";
import { determineActiveSessionAttribution } from "./overmind/active-session-attribution.js";
import { assessRegistrationCompleteness } from "./overmind/completeness.js";
import type { CompletenessResult } from "./overmind/completeness.js";
import { WatcherCooldowns } from "./overmind/cooldowns.js";
import {
  effectiveUnifiedIdleThresholdMs,
  getLastTrackedArtifactActivityMs,
  maybeFireArtifactFailsafe
} from "./overmind/idle-detector.js";
import { decideRunIdle } from "./overmind/idle-decision.js";
import { EvidenceReader } from "./overmind/evidence-reader.js";
import { cleanupWorkflowState } from "./overmind/workflow-cleanup.js";
import {
  applyDecisionInterception,
  applyNudgeLadder
} from "./overmind/nudge-ladder.js";
import { handleAllTasksDone } from "./overmind/completion-detector.js";
import { sendGuardedParentNudge } from "./overmind/parent-nudge-guard.js";
export class OvermindWatcher {
  private interval: NodeJS.Timeout | null = null;
  private readonly childPaneHashes = new Map<number, Map<string, string>>();
  private lastReconcileAt = 0;
  private readonly lastReconcileAsk = new Map<number, string>();
  private readonly cooldowns = new WatcherCooldowns();
  private readonly evidenceReader: EvidenceReader;
  private readonly subagentInFlight = new Map<
    number,
    { source: "tui" | "ack"; since: number; name?: string; expectedEndAt?: number }
  >();
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
      const freshActiveWorkflows = this.overmindService.list().filter(
        (workflow) => !TERMINAL_STATUSES.includes(workflow.status)
      );
      await this.reconcile(freshActiveWorkflows);
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
  async reconcile(workflows: OvermindWorkflow[]): Promise<void> {
    for (const originalWorkflow of workflows) {
      const workflow = this.overmindService.get(originalWorkflow.id) ?? originalWorkflow;
      if (!workflow.info_request || workflow.monitoring_paused) {
        this.lastReconcileAsk.delete(workflow.id);
        this.nudgeState?.setLastReconcileAsk(workflow.id, null);
        if (workflow.monitoring_paused) continue;
        continue;
      }
      if (this.subagentInFlight.has(workflow.id)) continue;
      try {
        const gapSignature = workflow.info_check ?? workflow.info_request;
        const lastAskedSignature =
          this.nudgeState?.getLastReconcileAsk(workflow.id) ??
          this.lastReconcileAsk.get(workflow.id) ??
          null;
        if (lastAskedSignature === gapSignature) continue;
        const problemDesc = workflow.info_request;
        const msg =
          `Overmind: registration gap detected (${problemDesc}) — update child roster with overmind.sh child-add/child-rm or POST /api/overmind/children, ` +
          `and update your task list (POST /api/overmind/tasks) if it has changed since you last reported.`;
        const guarded = await sendGuardedParentNudge(
          workflow,
          "overmind: " + msg,
          {
            overmindService: this.overmindService,
            nudgeState: this.nudgeState,
            notify: this.notify
          },
          (target, text) => this.tmuxService.sendAndSubmit(target, text)
        );
        if (!guarded.sent) continue;
        this.lastReconcileAsk.set(workflow.id, gapSignature);
        this.nudgeState?.setLastReconcileAsk(workflow.id, gapSignature);
      } catch (error) {
        console.error(`Overmind reconcile failed for workflow ${workflow.id}:`, error);
      }
    }
  }
  private async tickWorkflow(workflow: OvermindWorkflow): Promise<void> {
    const now = new Date().toISOString();
    const resolvedRunDir = await this.resolveRunDir(workflow);
    const [
      coordinatorPane,
      childSnapshots,
      mtimeAdvanced,
      runDirExists,
      coordinatorSessionExists,
      trackedArtifactActivityMs,
      gitHeadActivityMs
    ] = await Promise.all([
      this.capturePaneSafe(workflow.coordinator_session),
      Promise.all(workflow.child_sessions.map((target) => this.captureChildSession(target))),
      runDirMtimeAdvanced(resolvedRunDir, workflow.last_activity_at),
      pathExists(resolvedRunDir),
      this.sessionExistsSafe(workflow.coordinator_session),
      getLastTrackedArtifactActivityMs(resolvedRunDir),
      gitHeadActivityMsBestEffort(resolvedRunDir)
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
    const noLiveChildSession = childStatuses.every((child) => child.status === "closed");
    const orphaned = !coordinatorSessionExists && noLiveChildSession;
    const parentStatus = classifyParentSession({
      coordinatorPane,
      coordinatorHashPrev: workflow.last_pane_hash,
      stuckSincePrev: workflow.stuck_since,
      now
    });
    let effectiveParentStatus: OvermindParentStatus = parentStatus;
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
        parent_status: effectiveParentStatus,
        child_statuses: childStatuses,
        orphaned,
        ...(result.lastActivityAt ? { last_activity_at: result.lastActivityAt } : {})
      });
      return;
    }
    const nowMs = Date.now();
    const wid = workflow.id;
    const idleDecision = decideRunIdle({
      coordinatorPane,
      childPanes,
      childStatuses,
      lastActivityAt: workflow.last_activity_at,
      lastParentUpdateAt: workflow.last_parent_update_at,
      taskLog: workflow.task_log ?? [],
      trackedArtifactActivityMs,
      gitHeadActivityMs,
      nowMs,
      idleThresholdMs: effectiveUnifiedIdleThresholdMs(workflow, this.appSettings)
    });
    const suppressProblemStatus = idleDecision.active && (result.status === "stuck" || result.stuckSince !== null);
    const busyPaneActive =
      idleDecision.coordinatorBusy || idleDecision.childBusy || idleDecision.childWorking;
    const effectiveResult = suppressProblemStatus
      ? {
        ...result,
        status: "working" as const,
        stuckSince: null,
        lastActivityAt: result.lastActivityAt ?? (busyPaneActive ? now : null)
      }
      : result;
    if (
      effectiveParentStatus === "stuck" &&
      (idleDecision.childBusy || idleDecision.childWorking || idleDecision.recentActivity)
    ) {
      effectiveParentStatus = "idle";
    }
    const ackMatch = parseSubagentAckFromPane(coordinatorPane);
    if (ackMatch && !this.subagentInFlight.has(wid)) {
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
    if (subAgentInFlight(coordinatorPane)) {
      const existing = this.subagentInFlight.get(wid);
      if (!existing || existing.source !== "ack") {
        this.subagentInFlight.set(wid, { source: "tui", since: nowMs });
      }
    }
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
        this.subagentInFlight.delete(wid);
      } else if (
        saEntry.expectedEndAt &&
        nowMs > saEntry.expectedEndAt + SUBAGENT_DURATION_GRACE_MS
      ) {
        this.subagentInFlight.delete(wid);
      }
    }
    const currentSaEntry = this.subagentInFlight.get(wid);
    if (!currentSaEntry) {
      if (idleDecision.idle) {
        if (!this.apparentIdleSince.has(wid)) {
          this.apparentIdleSince.set(wid, nowMs);
        }
      } else {
        this.apparentIdleSince.delete(wid);
      }
      const idleSince = this.apparentIdleSince.get(wid);
      if (
        idleSince !== undefined &&
        nowMs - idleSince >= SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS
      ) {
        const stuckCooldownMs = (this.appSettings?.get().stuck_nudge_cooldown_minutes ?? 20) * 60_000;
        const lastUnified = getLastUnifiedIdleNudgeAt(wid, this.cooldowns, this.nudgeState);
        if (nowMs - lastUnified >= stuckCooldownMs) {
          const hasChildren = (workflow.child_sessions?.length ?? 0) > 0;
          const msg = hasChildren
            ? "Overmind: all sessions appear idle — parent and all children are quiet.\n\nIf you have an in-process subagent running, reply with:\n  [OVERMIND] subagent <name> ~<N>min\nOtherwise, check callbacks.md for pending work, update progress.md with current status, or report STATUS."
            : "Overmind: your session appears idle — no child sessions are active.\n\nIf you have an in-process subagent running, reply with:\n  [OVERMIND] subagent <name> ~<N>min\nOtherwise, resume work or report STATUS.";
          try {
            const guarded = await sendGuardedParentNudge(
              workflow,
              "overmind: " + msg,
              {
                overmindService: this.overmindService,
                nudgeState: this.nudgeState,
                notify: this.notify
              },
              (target, text) => this.tmuxService.sendAndSubmit(target, text)
            );
            if (guarded.sent) {
              this.cooldowns.recordFired(wid, "unified_idle_nudge", nowMs);
              this.nudgeState?.setLastUnifiedIdleNudge(wid, nowMs);
            } else if (guarded.parent_status) {
              effectiveParentStatus = guarded.parent_status;
            }
          } catch (err) {
            console.error("Overmind PATH 2 idle nudge failed:", err);
          }
        }
      }
    }
    const artifactFailsafe = effectiveResult.status === "stuck"
      ? { fired: false }
      : await maybeFireArtifactFailsafe(workflow, resolvedRunDir, {
        overmindService: this.overmindService,
        tmuxService: this.tmuxService,
        cooldowns: this.cooldowns,
        appSettings: this.appSettings,
        nudgeState: this.nudgeState,
        notify: this.notify,
        TERMINAL_STATUSES,
        subagentInFlight: this.subagentInFlight.has(wid),
        activeWorkInProgress: busyPaneActive
      });
    if (artifactFailsafe.parent_status) {
      effectiveParentStatus = artifactFailsafe.parent_status;
    }
    if (this.subagentInFlight.has(wid) && !allTasksComplete(workflow.tasks)) {
      this.overmindService.update(workflow.id, {
        status: "working",
        pending_decision: effectiveResult.pendingDecision,
        last_pane_hash: effectiveResult.coordinatorHash,
        stuck_since: null,
        active_session: activeAttribution.active_session,
        active_role: activeAttribution.active_role,
        parent_status: effectiveParentStatus,
        child_statuses: childStatuses,
        orphaned,
        ...(effectiveResult.lastActivityAt ? { last_activity_at: effectiveResult.lastActivityAt } : {})
      });
      return;
    }
    if (orphaned && !allTasksComplete(workflow.tasks)) {
      this.overmindService.update(workflow.id, {
        status: effectiveResult.status === "working" ? "stuck" : effectiveResult.status,
        pending_decision: effectiveResult.pendingDecision,
        last_pane_hash: effectiveResult.coordinatorHash,
        stuck_since: effectiveResult.stuckSince ?? now,
        active_session: activeAttribution.active_session,
        active_role: activeAttribution.active_role,
        parent_status: "no-session",
        child_statuses: childStatuses,
        orphaned: true,
        ...(effectiveResult.lastActivityAt ? { last_activity_at: effectiveResult.lastActivityAt } : {})
      });
      return;
    }
    if (allTasksComplete(workflow.tasks)) {
      await handleAllTasksDone(
        workflow,
        coordinatorPane,
        effectiveResult.coordinatorHash,
        activeAttribution,
        orphaned ? "no-session" : effectiveParentStatus,
        childStatuses,
        orphaned,
        resolvedRunDir,
        {
          overmindService: this.overmindService,
          tmuxService: this.tmuxService,
          brain: this.brain,
          nudgeState: this.nudgeState,
          notify: this.notify,
          appSettings: this.appSettings,
          cooldowns: this.cooldowns,
          subagentInFlight: this.subagentInFlight.has(wid),
          paneChanged
        }
      );
      return;
    }
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
      : effectiveResult.status === "awaiting_decision"
        ? await applyDecisionInterception(workflow, effectiveResult.pendingDecision, {
          overmindService: this.overmindService,
          tmuxService: this.tmuxService,
          brain: this.brain,
          appSettings: this.appSettings,
          nudgeState: this.nudgeState,
          cooldowns: this.cooldowns,
          notify: this.notify
        })
        : await applyNudgeLadder(workflow, effectiveResult.status, coordinatorPane, {
          overmindService: this.overmindService,
          tmuxService: this.tmuxService,
          brain: this.brain,
          appSettings: this.appSettings,
          nudgeState: this.nudgeState,
          cooldowns: this.cooldowns,
          notify: this.notify
        });
    this.overmindService.update(workflow.id, {
      status: nudgeFields.status ?? effectiveResult.status,
      pending_decision: nudgeFields.pending_decision !== undefined
        ? nudgeFields.pending_decision
        : effectiveResult.pendingDecision,
      last_pane_hash: info.last_pane_hash ?? nudgeFields.last_pane_hash ?? effectiveResult.coordinatorHash,
      stuck_since: nudgeFields.stuck_since !== undefined ? nudgeFields.stuck_since : effectiveResult.stuckSince,
      active_session: activeAttribution.active_session,
      active_role: activeAttribution.active_role,
      parent_status: info.parent_status ?? nudgeFields.parent_status ?? effectiveParentStatus,
      child_statuses: childStatuses,
      info_request: info.info_request,
      info_check: info.info_check,
      orphaned: false,
      ...nudgeFields,
      ...(effectiveResult.lastActivityAt ? { last_activity_at: effectiveResult.lastActivityAt } : {})
    });
  }
  private async resolveRunDir(workflow: OvermindWorkflow): Promise<string> {
    if (path.isAbsolute(workflow.run_dir)) return workflow.run_dir;
    const cwd = await this.tmuxService.paneCurrentPath?.(workflow.coordinator_session);
    return cwd ? path.resolve(cwd, workflow.run_dir) : workflow.run_dir;
  }
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
    parent_status?: OvermindParentStatus;
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
    if (assessment.missing.length === 0) {
      return { info_request: null, info_check: null, requestedThisTick: false };
    }
    if (workflow.info_check === assessment.signature) {
      return { info_request: workflow.info_request, info_check: workflow.info_check, requestedThisTick: false };
    }
    let requestText = assessment.requestText;
    const requestLabel = assessment.requestLabel;
    if (!requestText) {
      return { info_request: requestLabel, info_check: assessment.signature, requestedThisTick: false };
    }
    let lastPaneHash: string | undefined;
    let parentStatus: OvermindParentStatus | undefined;
    try {
      const guarded = await sendGuardedParentNudge(
        workflow,
        "overmind: " + requestText,
        {
          overmindService: this.overmindService,
          nudgeState: this.nudgeState,
          notify: this.notify
        },
        (target, text) => this.tmuxService.sendAndSubmit(target, text)
      );
      if (guarded.sent) {
        lastPaneHash = hashPane(await this.capturePaneSafe(guarded.parentSession));
      } else {
        parentStatus = guarded.parent_status;
      }
    } catch (error) {
      console.error("Overmind completeness request failed:", error);
    }
    return {
      info_request: requestLabel,
      info_check: assessment.signature,
      last_pane_hash: lastPaneHash,
      parent_status: parentStatus,
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

async function gitHeadActivityMsBestEffort(runDir: string): Promise<number> {
  const gitDir = path.join(runDir, ".git");
  try {
    const headPath = path.join(gitDir, "HEAD");
    const [headRaw, headStat] = await Promise.all([
      readFile(headPath, "utf8"),
      stat(headPath)
    ]);
    const refMatch = /^ref:\s*(.+)\s*$/m.exec(headRaw);
    if (!refMatch) return headStat.mtimeMs;
    try {
      const refStat = await stat(path.join(gitDir, refMatch[1]));
      return Math.max(headStat.mtimeMs, refStat.mtimeMs);
    } catch {
      return headStat.mtimeMs;
    }
  } catch {
    return 0;
  }
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
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
