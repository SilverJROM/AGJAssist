import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
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

export const POLL_MS = 45_000;
export const RECONCILE_MS = 1_800_000;
export const STUCK_THRESHOLD_MS = 90_000;
export const CAPTURE_LINES = 200;
export const MAX_CANNED_NUDGES = 2;
export const BRAIN_COORDINATOR_TAIL_LINES = 40;
export const BRAIN_RUN_FILE_TAIL_LINES = 80;
export const DECISION_HANDLED_TIER = 4;
export const PRIOR_DECISION_CONTEXT_CHAR_LIMIT = 6000;
export const PRIOR_DECISION_FILE_CHAR_LIMIT = 1000;
export const PRIOR_DECISION_MAX_FILES = 5;
export const CANNED_NUDGE =
  "Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS.";
// Deterministic fallback consult text when the Sonnet completion brain is unavailable.
export const ALL_DONE_CONFIRM_NUDGE = DEFAULT_COMPLETION_CONSULT_TEXT;
export const FRONTLOAD_CORRECTION_NOTE =
  "Overmind: that decision should have been frontloaded at intake (projcore §1.4a) — please put such decisions in the north-star next time.";

const NUMBERED_OPTION_RE = /^\s*\d+\.\s+\S+/m;
const DECISION_FOOTER_RE = /Enter to select|Tab\/Arrow keys to navigate|Type something|Chat about this/i;
const HUMAN_WAIT_RE = /\bNEEDS-INFO\b|needs info|waiting for (human|user|input)|blocked on (human|user|input)|\bquestion\b|\bplease (confirm|choose|provide|advise)\b/i;
const RUN_DIR_ACTIVITY_FILES = ["callbacks.md", "progress.md", "queue.md"] as const;
const TERMINAL_STATUSES: OvermindWorkflowStatus[] = ["paused", "completed", "failed"];

export type OvermindNotify = (text: string) => Promise<void>;
export type OvermindUpdate = (workflows: OvermindWorkflow[]) => void | Promise<void>;

export interface ClassifyWorkflowInput {
  coordinatorPane: string;
  childPanes: string[];
  childPaneHashChanged?: boolean;
  coordinatorHashPrev: string | null;
  mtimeAdvanced: boolean;
  stuckSincePrev: string | null;
  now: string;
}

export interface ClassifyResult {
  status: "working" | "stuck" | "waiting_human" | "awaiting_decision";
  coordinatorHash: string;
  pendingDecision: string | null;
  stuckSince: string | null;
  lastActivityAt: string | null;
}

export interface ClassifyParentSessionInput {
  coordinatorPane: string;
  coordinatorHashPrev: string | null;
  stuckSincePrev: string | null;
  now: string;
}

export interface ActiveSessionAttribution {
  active_session: string | null;
  active_role: "parent" | "child" | null;
}

interface NudgeLadderFields {
  nudge_count: number;
  tier: number;
  status?: OvermindWorkflowStatus;
  last_pane_hash?: string;
  stuck_since?: string | null;
  pending_decision?: string | null;
}

export function hashPane(pane: string): string {
  return createHash("sha256").update(extractBody(pane)).digest("hex");
}

export function hasActiveTurn(pane: string): boolean {
  const statusBarChromeRe = /ctrl\+t|bypass permissions|to manage|for agents|\bshells?\b|\bmonitors?\b|shift\+tab/i;
  return pane
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => /esc to interrupt/i.test(line) && !statusBarChromeRe.test(line));
}

export function extractBody(pane: string): string {
  const lines = pane
    .replace(/\r\n/g, "\n")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .filter((line) => !isPaneChromeLine(line));

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function isPaneChromeLine(line: string): boolean {
  const trimmed = line.trim();
  const spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
  const leadingSpinnerRe = new RegExp(`^\\s*[${spinnerGlyphs}]`, "u");
  const statusChromeRe = /bypass permissions|ctrl\+t|to manage|for agents|\/ps to view|\/stop|\bshells?\b|\bmonitors?\b|\/model/i;
  const modelFooterRe = /^\s*(gpt-5|sonnet|opus|haiku)\b/i;
  const cwdFooterRe = /[·•]\s*~\/\S*\s*$/;
  const turnChromeRe = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;

  return trimmed === "" ? false
    : /^[❯›]/u.test(trimmed)
      || /^[─=]{3,}$/.test(trimmed)
      || leadingSpinnerRe.test(line)
      || statusChromeRe.test(line)
      || modelFooterRe.test(line)
      || cwdFooterRe.test(line)
      || turnChromeRe.test(line);
}

export function allTasksComplete(tasks: { state: string }[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.state === "done");
}

export function determineActiveSessionAttribution(input: {
  coordinatorSession: string;
  coordinatorPane: string;
  childSessions: string[];
  childPanes: string[];
}): ActiveSessionAttribution {
  if (hasActiveTurn(input.coordinatorPane)) {
    return {
      active_session: input.coordinatorSession,
      active_role: "parent"
    };
  }

  const activeChildIndex = input.childPanes.findIndex((pane) => hasActiveTurn(pane));
  if (activeChildIndex >= 0) {
    return {
      active_session: input.childSessions[activeChildIndex] ?? null,
      active_role: input.childSessions[activeChildIndex] ? "child" : null
    };
  }

  return {
    active_session: null,
    active_role: null
  };
}

export function classifyWorkflow(input: ClassifyWorkflowInput): ClassifyResult {
  const coordinatorHash = hashPane(input.coordinatorPane);
  const coordinatorHashChanged =
    input.coordinatorHashPrev !== null && coordinatorHash !== input.coordinatorHashPrev;
  const childPaneHashChanged = input.childPaneHashChanged === true;
  const activeTurn = hasActiveTurn(input.coordinatorPane) || input.childPanes.some((pane) => hasActiveTurn(pane));

  if (activeTurn || coordinatorHashChanged || input.mtimeAdvanced || childPaneHashChanged) {
    return {
      status: "working",
      coordinatorHash,
      pendingDecision: null,
      stuckSince: null,
      lastActivityAt: input.now
    };
  }

  if (isDecisionPrompt(input.coordinatorPane)) {
    return {
      status: "awaiting_decision",
      coordinatorHash,
      pendingDecision: capturePendingDecision(input.coordinatorPane),
      stuckSince: null,
      lastActivityAt: null
    };
  }

  if (HUMAN_WAIT_RE.test(input.coordinatorPane)) {
    return {
      status: "waiting_human",
      coordinatorHash,
      pendingDecision: null,
      stuckSince: null,
      lastActivityAt: null
    };
  }

  const stuckSince = input.stuckSincePrev ?? input.now;
  return {
    status: isPastStuckThreshold(stuckSince, input.now) ? "stuck" : "working",
    coordinatorHash,
    pendingDecision: null,
    stuckSince,
    lastActivityAt: null
  };
}

export function classifyParentSession(input: ClassifyParentSessionInput): OvermindParentStatus {
  const coordinatorHash = hashPane(input.coordinatorPane);
  const coordinatorHashChanged =
    input.coordinatorHashPrev !== null && coordinatorHash !== input.coordinatorHashPrev;

  if (hasActiveTurn(input.coordinatorPane) || coordinatorHashChanged) {
    return "working";
  }

  if (isDecisionPrompt(input.coordinatorPane)) {
    return "awaiting_decision";
  }

  if (HUMAN_WAIT_RE.test(input.coordinatorPane)) {
    return "waiting_human";
  }

  if (input.stuckSincePrev && isPastStuckThreshold(input.stuckSincePrev, input.now)) {
    return "stuck";
  }

  return "idle";
}

export function classifyChildSessionStatus(input: {
  pane: string;
  exists: boolean;
  paneHashChanged?: boolean;
}): OvermindChildSessionStatus["status"] {
  if (!input.exists) return "closed";
  return hasActiveTurn(input.pane) || input.paneHashChanged === true ? "working" : "idle";
}

// Grace before nagging about an empty tasklist — a freshly-registered run may push its
// tasks a beat after register. Past this, an empty tasklist is a genuine omission.
export const EMPTY_TASKLIST_GRACE_MS = 60_000;
// How long the parent can go without any /api/overmind/tasks update before it's flagged
// as "stale" — catches Lokalcamp-style silent runs where /complete was never called.
export const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface CompletenessInput {
  tasks: { state: string }[];
  childSessions: string[];
  childRoles: string[];
  childStatuses: { session: string; status: string }[];
  runDir: string;
  runDirExists: boolean;
  ageMs: number;
  currentTask: string | null;
  // For stale detection: ISO timestamp of the run start, last task_log entry, and current time
  runStartedAt: string | null;
  taskLogLastAt: string | null;
  nowMs: number;
}

export interface CompletenessResult {
  // machine keys of what's missing/inconsistent: tasklist | run_dir | dead_child | roles
  missing: string[];
  // short badge text for the dashboard (e.g. "tasklist, roles"); null when complete
  requestLabel: string | null;
  // canned coordinator-pane request listing the gaps; null when complete or brain-only
  requestText: string | null;
  // re-arm key: identical signature => same gap set => don't re-ask
  signature: string;
  // present-but-contradictory: deterministic check can't phrase a confident ask -> Sonnet
  needsBrain: boolean;
}

// Deterministic registration/data completeness check (the ~90%). Pure: no I/O. The caller
// runs this only for live, not-all-done workflows. Each gap maps to a canned ask aimed at
// the coordinator (projcore), NOT JROM. `needsBrain` flags the residual inconsistent case.
export function assessRegistrationCompleteness(input: CompletenessInput): CompletenessResult {
  const missing: string[] = [];
  const labels: string[] = [];
  const lines: string[] = [];

  if (input.tasks.length === 0 && input.ageMs >= EMPTY_TASKLIST_GRACE_MS) {
    missing.push("tasklist");
    labels.push("tasklist");
    lines.push("push your batch tasklist — it is empty, so the dashboard shows 0/0 (build it from queue.md or your batch plan / req-matrix.md)");
  }

  if (!input.runDirExists) {
    missing.push("run_dir");
    labels.push("run_dir");
    lines.push(`your run_dir '${input.runDir}' is not found on disk — re-register with the correct absolute path`);
  }

  const deadChildren = input.childStatuses.filter((c) => c.status === "closed").map((c) => c.session);
  if (deadChildren.length > 0) {
    missing.push("dead_child");
    labels.push("roster");
    lines.push(`child session(s) ${deadChildren.join(", ")} are no longer alive — re-register with the correct child_sessions roster`);
  }

  const rolesMissing =
    input.childSessions.length > 1 &&
    (input.childRoles.length !== input.childSessions.length ||
      input.childRoles.some((r) => !r || !r.trim()));
  if (rolesMissing) {
    missing.push("roles");
    labels.push("roles");
    lines.push("send child_roles (aligned by index with child_sessions) so the dashboard labels your agents (e.g. coder/tester)");
  }

  // Half-broken register: child_roles declared but no child_sessions provided.
  // Distinct from the `roles` check above (which fires for ≥2 children with mismatched counts).
  if (input.childRoles.length > 0 && input.childSessions.length === 0) {
    missing.push("roles_without_sessions");
    labels.push("roster");
    lines.push(
      `you registered child_roles (${input.childRoles.join(", ")}) but no child_sessions — please re-register with the actual child session names.`
    );
  }

  // Stale parent: the parent has not sent any /api/overmind/tasks update for >STALE_THRESHOLD_MS.
  // Catches Lokalcamp-style silent runs where the run finished but /complete was never called.
  // Skip when tasks are empty and within grace (leave that to the tasklist check) or when there
  // are no tasks at all (can't tell if done; defer to tasklist check).
  const notAllDone = input.tasks.length > 0 && !input.tasks.every((t) => t.state === "done");
  if (notAllDone) {
    const lastParentUpdateMs = (() => {
      const fromLog = input.taskLogLastAt ? Date.parse(input.taskLogLastAt) : NaN;
      const fromStart = input.runStartedAt ? Date.parse(input.runStartedAt) : NaN;
      const candidates = [fromLog, fromStart].filter((v) => !Number.isNaN(v));
      return candidates.length > 0 ? Math.max(...candidates) : null;
    })();

    if (lastParentUpdateMs !== null && input.nowMs - lastParentUpdateMs > STALE_THRESHOLD_MS) {
      const ageHours = Math.round((input.nowMs - lastParentUpdateMs) / (60 * 60 * 1000));
      missing.push("stale");
      labels.push("stale");
      lines.push(
        `your last update to overmind was ~${ageHours}h ago — if you're still running, send a /api/overmind/tasks update; if the run is finished, POST /api/overmind/complete.`
      );
    }
  }

  // Inconsistency the canned checks can't resolve: current_task names a batch token
  // (e.g. "B3"/"A2") but no task in the published list matches it. Defer to Sonnet.
  let needsBrain = false;
  if (input.tasks.length > 0 && input.currentTask) {
    const token = input.currentTask.trim().match(/^([A-Za-z]?\d+)\b/)?.[1];
    if (token) {
      const tasksAny = input.tasks as Array<{ id?: string; label?: string }>;
      const matched = tasksAny.some(
        (t) =>
          (t.id && t.id.toLowerCase() === token.toLowerCase()) ||
          (t.label && t.label.toLowerCase().includes(token.toLowerCase()))
      );
      if (!matched) {
        needsBrain = true;
        if (!missing.includes("task_mismatch")) missing.push("task_mismatch");
      }
    }
  }

  const signature = [...missing].sort().join("|");
  return {
    missing,
    requestLabel: labels.length ? labels.join(", ") : (needsBrain ? "task mismatch" : null),
    requestText: lines.length
      ? `Overmind: your overmind registration looks incomplete — please re-register/update so I can track this run:\n- ${lines.join("\n- ")}`
      : null,
    signature,
    needsBrain
  };
}

export class OvermindWatcher {
  private interval: NodeJS.Timeout | null = null;
  private readonly childPaneHashes = new Map<number, Map<string, string>>();
  private lastReconcileAt = 0;
  // Per-workflow dedupe: workflowId → gap signature last asked. Prevents re-asking the
  // same unchanged gap every 30-min cycle. Cleared when the gap resolves so a fresh
  // recurrence triggers a new ask.
  private readonly lastReconcileAsk = new Map<number, string>();

  constructor(
    private readonly overmindService: OvermindService,
    private readonly tmuxService: TmuxService,
    private readonly notify?: OvermindNotify,
    private readonly brain?: OvermindBrain,
    private readonly onUpdate?: OvermindUpdate
  ) {}

  async tick(): Promise<void> {
    const workflows = this.overmindService
      .list()
      .filter((workflow) => !TERMINAL_STATUSES.includes(workflow.status));

    await Promise.all(workflows.map((workflow) => this.tickWorkflow(workflow)));

    if (Date.now() - this.lastReconcileAt >= RECONCILE_MS) {
      await this.reconcile(workflows);
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
        if (workflow.monitoring_paused) continue;
        continue;
      }

      try {
        const parentAlive = await this.sessionExistsSafe(workflow.coordinator_session);
        if (!parentAlive) continue;

        // Compute the gap signature: prefer info_check (richer, already encodes the gap set);
        // fall back to info_request if info_check is not yet populated.
        const gapSignature = workflow.info_check ?? workflow.info_request;

        // Same gap as last ask — do not nag again.
        if (this.lastReconcileAsk.get(workflow.id) === gapSignature) continue;

        const problemDesc = workflow.info_request;
        const msg =
          `Overmind: registration gap detected (${problemDesc}) — please re-register your CURRENT child_sessions, child_roles, and status to overmind now (POST /api/overmind/register), ` +
          `and update your task list (POST /api/overmind/tasks) if it has changed since you last reported.`;
        await this.tmuxService.sendAndSubmit(workflow.coordinator_session, msg);

        // Record the signature we just asked so future cycles with the same gap skip.
        this.lastReconcileAsk.set(workflow.id, gapSignature);
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
    const [coordinatorPane, childSnapshots, mtimeAdvanced, runDirExists] = await Promise.all([
      this.capturePaneSafe(workflow.coordinator_session),
      Promise.all(workflow.child_sessions.map((target) => this.captureChildSession(target))),
      runDirMtimeAdvanced(resolvedRunDir, workflow.last_activity_at),
      pathExists(resolvedRunDir)
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

    // Monitoring paused (JROM is talking to this coordinator): keep the display live
    // (status, parent/child, attribution) so overmind stays AWARE, but suppress every
    // interrupt — no completion consult, no completeness request, no nudge, no brain,
    // no notification. Resume re-arms everything on the next tick.
    if (workflow.monitoring_paused) {
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
    const info = await this.applyCompleteness(workflow, {
      childStatuses,
      runDirExists,
      resolvedRunDir,
      now
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
    ctx: { childStatuses: OvermindChildSessionStatus[]; runDirExists: boolean; resolvedRunDir: string; now: string }
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
      runDir: workflow.run_dir,
      runDirExists: ctx.runDirExists,
      ageMs,
      currentTask: workflow.current_task,
      runStartedAt: workflow.run_started_at ?? null,
      taskLogLastAt: workflow.task_log?.[workflow.task_log.length - 1]?.at ?? null,
      nowMs: new Date(ctx.now).getTime()
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
    let requestLabel = assessment.requestLabel;
    if (assessment.needsBrain && this.brain?.reviewRegistration) {
      const verdict = await this.reviewRegistration(workflow, assessment, ctx.resolvedRunDir);
      if (verdict.action === "false-alarm") {
        return { info_request: null, info_check: assessment.signature, requestedThisTick: false };
      }
      if (verdict.action === "escalate") {
        if (verdict.escalateText) {
          await this.notify?.(verdict.escalateText).catch(() => undefined);
        }
        return { info_request: requestLabel, info_check: assessment.signature, requestedThisTick: false };
      }
      requestText = verdict.requestText ?? requestText;
      requestLabel = verdict.requestLabel ?? requestLabel;
    }

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

  private async reviewRegistration(
    workflow: OvermindWorkflow,
    assessment: CompletenessResult,
    resolvedRunDir: string
  ): Promise<RegistrationReviewVerdict> {
    if (!this.brain?.reviewRegistration) {
      return { action: "request", requestText: assessment.requestText ?? undefined, reason: "deterministic fallback" };
    }
    try {
      return await this.brain.reviewRegistration({
        label: workflow.label,
        missing: assessment.missing,
        currentTask: workflow.current_task,
        tasksSummary: summarizeTasks(workflow.tasks),
        childSessions: workflow.child_sessions,
        childRoles: workflow.child_roles,
        progressTail: await readRunFileTail(resolvedRunDir, "progress.md", BRAIN_RUN_FILE_TAIL_LINES),
        callbacksTail: await readRunFileTail(resolvedRunDir, "callbacks.md", BRAIN_RUN_FILE_TAIL_LINES)
      });
    } catch (error) {
      console.error("Overmind registration review brain failed:", error);
      return { action: "request", requestText: assessment.requestText ?? undefined, reason: "deterministic fallback" };
    }
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

    const nextNudgeCount = workflow.nudge_count + 1;
    await this.tmuxService.sendAndSubmit(workflow.coordinator_session, CANNED_NUDGE);
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

function applyAlwaysEscalateGuardrail(
  pendingDecision: string,
  verdict: DecisionVerdict
): DecisionVerdict {
  if (!hasAlwaysEscalateKeyword(pendingDecision)) {
    return verdict;
  }
  return {
    action: "escalate",
    reason: `Deterministic ALWAYS_ESCALATE_KEYWORDS guardrail matched the pending decision; overriding brain action=${verdict.action}.`
  };
}

interface PriorDecisionMatch {
  filePath: string;
  score: number;
  matchedTerms: string[];
  snippet: string;
  mtimeMs: number;
}

export async function collectPriorDecisions(runDir: string, topic: string): Promise<string> {
  const terms = extractDecisionTerms(topic);
  const files = await listDecisionFiles([
    path.join(runDir, "decisions"),
    path.join(homedir(), ".claude/JROM/decisions")
  ]);
  const matches: PriorDecisionMatch[] = [];

  for (const filePath of files) {
    const raw = await readFileBestEffort(filePath);
    if (!raw) continue;
    const lowerPath = filePath.toLowerCase();
    const lowerRaw = raw.toLowerCase();
    const matchedTerms = terms.filter((term) => lowerPath.includes(term) || lowerRaw.includes(term));
    if (matchedTerms.length === 0 && terms.length > 0) continue;
    const fileStat = await statBestEffort(filePath);
    matches.push({
      filePath,
      score: matchedTerms.reduce((score, term) => {
        const inPath = lowerPath.includes(term) ? 3 : 0;
        const inBody = countOccurrences(lowerRaw, term);
        return score + inPath + inBody;
      }, terms.length === 0 ? 1 : 0),
      matchedTerms,
      snippet: selectDecisionSnippet(raw, matchedTerms),
      mtimeMs: fileStat?.mtimeMs ?? 0
    });
  }

  if (matches.length === 0) {
    const recentFiles = await Promise.all(
      files.slice(-PRIOR_DECISION_MAX_FILES).map(async (filePath) => ({
        filePath,
        raw: await readFileBestEffort(filePath),
        fileStat: await statBestEffort(filePath)
      }))
    );
    for (const recent of recentFiles) {
      if (!recent.raw) continue;
      matches.push({
        filePath: recent.filePath,
        score: 0,
        matchedTerms: [],
        snippet: recent.raw.slice(0, PRIOR_DECISION_FILE_CHAR_LIMIT),
        mtimeMs: recent.fileStat?.mtimeMs ?? 0
      });
    }
  }

  const selected = matches
    .sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs)
    .slice(0, PRIOR_DECISION_MAX_FILES);

  let output = "";
  for (const match of selected) {
    const entry = [
      `Source: ${match.filePath}`,
      `Matched terms: ${match.matchedTerms.length ? match.matchedTerms.join(", ") : "<recent fallback>"}`,
      match.snippet.trim()
    ].join("\n");
    const next = output ? `${output}\n\n---\n${entry}` : entry;
    if (next.length > PRIOR_DECISION_CONTEXT_CHAR_LIMIT) {
      const remaining = PRIOR_DECISION_CONTEXT_CHAR_LIMIT - output.length;
      if (remaining > 200) output += `\n\n---\n${entry.slice(0, remaining)}`;
      break;
    }
    output = next;
  }

  return output.slice(0, PRIOR_DECISION_CONTEXT_CHAR_LIMIT);
}

function extractDecisionTerms(text: string): string[] {
  const stop = new Set([
    "about",
    "after",
    "before",
    "blocked",
    "choose",
    "confirm",
    "continue",
    "could",
    "decision",
    "default",
    "enter",
    "human",
    "input",
    "jrom",
    "needs",
    "option",
    "please",
    "projcore",
    "question",
    "should",
    "status",
    "stuck",
    "their",
    "there",
    "these",
    "thing",
    "which",
    "workflow",
    "would"
  ]);
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]{3,}/g)
        ?.filter((term) => !stop.has(term) && !/^\d+$/.test(term))
        .slice(0, 24) ?? []
    )
  );
}

async function listDecisionFiles(dirs: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(path.join(dir, entry.name));
        }
      }
    } catch {
      // Missing decisions directories are expected for some workflows.
    }
  }
  return files;
}

function selectDecisionSnippet(raw: string, matchedTerms: string[]): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lower = normalized.toLowerCase();
  const firstIndex = matchedTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstIndex - 300);
  return normalized.slice(start, start + PRIOR_DECISION_FILE_CHAR_LIMIT);
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

async function statBestEffort(filePath: string): Promise<{ mtimeMs: number } | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function checkedContextLine(): string {
  return "workflow north-star.md, trust-defaults.md, and relevance-filtered prior decisions";
}

function hashShort(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function isDecisionPrompt(pane: string): boolean {
  return NUMBERED_OPTION_RE.test(pane) && DECISION_FOOTER_RE.test(pane);
}

function capturePendingDecision(pane: string): string {
  const lines = pane
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstOptionIndex = lines.findIndex((line) => /^\d+\.\s+\S+/.test(line));
  const start = firstOptionIndex === -1 ? Math.max(0, lines.length - 12) : Math.max(0, firstOptionIndex - 3);
  return lines.slice(start, start + 14).join("\n").slice(0, 2000);
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

function isPastStuckThreshold(stuckSince: string, now: string): boolean {
  const stuckSinceMs = parseTimestamp(stuckSince);
  const nowMs = parseTimestamp(now);
  if (stuckSinceMs === null || nowMs === null) return false;
  return nowMs - stuckSinceMs >= STUCK_THRESHOLD_MS;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}
