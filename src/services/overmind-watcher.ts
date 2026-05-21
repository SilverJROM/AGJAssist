import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { OvermindService, OvermindWorkflow, OvermindWorkflowStatus } from "./overmind-service.js";
import { TmuxService } from "../tmux/tmux-service.js";

export const POLL_MS = 45_000;
export const STUCK_THRESHOLD_MS = 90_000;
export const CAPTURE_LINES = 200;
export const MAX_CANNED_NUDGES = 2;
export const CANNED_NUDGE =
  "Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS.";

const BUSY_MARKER_RE = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;
const NUMBERED_OPTION_RE = /^\s*\d+\.\s+\S+/m;
const DECISION_FOOTER_RE = /Enter to select|Tab\/Arrow keys to navigate|Type something|Chat about this/i;
const HUMAN_WAIT_RE = /\bNEEDS-INFO\b|needs info|waiting for (human|user|input)|blocked on (human|user|input)|\bquestion\b|\bplease (confirm|choose|provide|advise)\b/i;
const RUN_DIR_ACTIVITY_FILES = ["callbacks.md", "progress.md", "queue.md"] as const;
const TERMINAL_STATUSES: OvermindWorkflowStatus[] = ["paused", "completed", "failed"];

export type OvermindNotify = (text: string) => Promise<void>;

export interface ClassifyWorkflowInput {
  coordinatorPane: string;
  childPanes: string[];
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

export function hashPane(pane: string): string {
  return createHash("sha256").update(pane).digest("hex");
}

export function classifyWorkflow(input: ClassifyWorkflowInput): ClassifyResult {
  const coordinatorHash = hashPane(input.coordinatorPane);
  const panes = [input.coordinatorPane, ...input.childPanes];
  const hasBusyMarker = panes.some((pane) => BUSY_MARKER_RE.test(pane));
  const coordinatorHashChanged =
    input.coordinatorHashPrev !== null && coordinatorHash !== input.coordinatorHashPrev;

  if (hasBusyMarker || coordinatorHashChanged || input.mtimeAdvanced) {
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

export class OvermindWatcher {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly overmindService: OvermindService,
    private readonly tmuxService: TmuxService,
    private readonly notify?: OvermindNotify
  ) {}

  async tick(): Promise<void> {
    const workflows = this.overmindService
      .list()
      .filter((workflow) => !TERMINAL_STATUSES.includes(workflow.status));

    await Promise.all(workflows.map((workflow) => this.tickWorkflow(workflow)));
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

  private async tickWorkflow(workflow: OvermindWorkflow): Promise<void> {
    const now = new Date().toISOString();
    const [coordinatorPane, childPanes, mtimeAdvanced] = await Promise.all([
      this.capturePaneSafe(workflow.coordinator_session),
      Promise.all(workflow.child_sessions.map((target) => this.capturePaneSafe(target))),
      runDirMtimeAdvanced(workflow.run_dir, workflow.last_activity_at)
    ]);

    const result = classifyWorkflow({
      coordinatorPane,
      childPanes,
      coordinatorHashPrev: workflow.last_pane_hash,
      mtimeAdvanced,
      stuckSincePrev: workflow.stuck_since,
      now
    });

    const nudgeFields = await this.applyNudgeLadder(workflow, result.status);

    this.overmindService.update(workflow.id, {
      status: result.status,
      pending_decision: result.pendingDecision,
      last_pane_hash: result.coordinatorHash,
      stuck_since: result.stuckSince,
      ...nudgeFields,
      ...(result.lastActivityAt ? { last_activity_at: result.lastActivityAt } : {})
    });
  }

  private async applyNudgeLadder(
    workflow: OvermindWorkflow,
    status: ClassifyResult["status"]
  ): Promise<Pick<OvermindWorkflow, "nudge_count" | "tier">> {
    if (status === "working") {
      return { nudge_count: 0, tier: 0 };
    }

    if (status !== "stuck") {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }

    if (workflow.nudge_count >= MAX_CANNED_NUDGES) {
      // A6: Tier 3 Sonnet brain here.
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }

    const nextNudgeCount = workflow.nudge_count + 1;
    await this.tmuxService.sendCommand(workflow.coordinator_session, CANNED_NUDGE, true, true);
    return { nudge_count: nextNudgeCount, tier: nextNudgeCount };
  }

  async notifyDone(workflow: OvermindWorkflow): Promise<void> {
    await this.notifyBestEffort(`DONE · overmind · ${workflow.label}\n${workflow.label} completed.`);
  }

  async notifyBlocked(workflow: OvermindWorkflow, reason: string): Promise<void> {
    await this.notifyBestEffort(`BLOCKED · overmind · ${workflow.label}\n${reason}`);
  }

  private async notifyBestEffort(text: string): Promise<void> {
    if (!this.notify) return;
    try {
      await this.notify(text);
    } catch (error) {
      console.error("Overmind notify failed:", error);
    }
  }

  private async capturePaneSafe(target: string): Promise<string> {
    try {
      return await this.tmuxService.capturePane(target, CAPTURE_LINES);
    } catch {
      return "";
    }
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
