// Pure status classifiers for overmind workflows — given pane snapshots + a few
// pieces of prior state, return the canonical status enum. No DB, no tmux, no
// IO. Extracted from overmind-watcher.ts in batch B4 of the modularization
// refactor (2026-05-23). Tests live in tests/overmind-classifier.test.ts.

import {
  OvermindChildSessionStatus,
  OvermindParentStatus,
  OvermindWorkflowStatus
} from "../overmind-service.js";
import { hashPane, hasActiveTurn } from "./pane-utils.js";
import { subAgentInFlight } from "./subagent-detection.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const STUCK_THRESHOLD_MS = 90_000;
export const NUMBERED_OPTION_RE = /^\s*\d+\.\s+\S+/m;
export const DECISION_FOOTER_RE = /Enter to select|Tab\/Arrow keys to navigate|Type something|Chat about this/i;
export const HUMAN_WAIT_RE = /\bNEEDS-INFO\b|needs info|waiting for (human|user|input)|blocked on (human|user|input)|\bquestion\b|\bplease (confirm|choose|provide|advise)\b/i;

// ─── Input/output shapes ─────────────────────────────────────────────────────

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

// ─── Top-level classifiers ───────────────────────────────────────────────────

export function allTasksComplete(tasks: { state: string }[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.state === "done");
}

/**
 * Regex-scan a text blob for evidence of task-id states. Returns ONLY ids the
 * regexes matched (no fabrication for unmentioned ids). Case-insensitive, word-
 * boundaried. Patterns follow the locked design.
 */
export function deriveTaskStateFromText(
  text: string,
  tasks: { id: string }[]
): Map<string, "done" | "in-progress" | "unknown"> {
  const result = new Map<string, "done" | "in-progress" | "unknown">();
  const lower = text.toLowerCase();

  for (const task of tasks) {
    const id = task.id;
    if (!id) continue;
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Done patterns:
    //   \b<id>\b[^\n]{0,40}(PASS|done|merged|VERIFIED)
    //   (?:✓|✔|\[x\])\s*<id>\b
    //   <id>\s*(?:✓|✔|done|PASS)
    const doneRe = new RegExp(
      `\\b${escapedId}\\b[^\\n]{0,40}(?:pass|done|merged|verified)\\b` +
      `|(?:✓|✔|\\[x\\])\\s*${escapedId}\\b` +
      `|\\b${escapedId}\\s*(?:✓|✔|done|pass)`,
      "i"
    );

    // In-progress patterns:
    //   \b<id>\b[^\n]{0,40}(in-flight|in-progress|processing|REVISE|iter-N|FAIL)
    const inProgressRe = new RegExp(
      `\\b${escapedId}\\b[^\\n]{0,40}(?:in[\\s\\-]?flight|in[\\s\\-]?progress|processing|revise|iter[\\s\\-]?\\d|fail)\\b`,
      "i"
    );

    if (doneRe.test(lower)) {
      result.set(id, "done");
    } else if (inProgressRe.test(lower)) {
      result.set(id, "in-progress");
    }
    // Otherwise: no match → do NOT add to result (don't infer pending for unknown)
  }

  return result;
}

export function classifyWorkflow(input: ClassifyWorkflowInput): ClassifyResult {
  const coordinatorHash = hashPane(input.coordinatorPane);
  const coordinatorHashChanged =
    input.coordinatorHashPrev !== null && coordinatorHash !== input.coordinatorHashPrev;
  const childPaneHashChanged = input.childPaneHashChanged === true;
  const activeTurn = hasActiveTurn(input.coordinatorPane) || input.childPanes.some((pane) => hasActiveTurn(pane));
  // In-process sub-agent running inside the coordinator counts as active work.
  const subAgentRunning = subAgentInFlight(input.coordinatorPane);

  if (activeTurn || coordinatorHashChanged || input.mtimeAdvanced || childPaneHashChanged || subAgentRunning) {
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

// ─── Internal helpers (exported for unit tests + the watcher re-export shim) ─

export function isDecisionPrompt(pane: string): boolean {
  return NUMBERED_OPTION_RE.test(pane) && DECISION_FOOTER_RE.test(pane);
}

export function capturePendingDecision(pane: string): string {
  const lines = pane
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstOptionIndex = lines.findIndex((line) => /^\d+\.\s+\S+/.test(line));
  const start = firstOptionIndex === -1 ? Math.max(0, lines.length - 12) : Math.max(0, firstOptionIndex - 3);
  return lines.slice(start, start + 14).join("\n").slice(0, 2000);
}

export function isPastStuckThreshold(stuckSince: string, now: string): boolean {
  const stuckSinceMs = parseClassifierTimestamp(stuckSince);
  const nowMs = parseClassifierTimestamp(now);
  if (stuckSinceMs === null || nowMs === null) return false;
  return nowMs - stuckSinceMs >= STUCK_THRESHOLD_MS;
}

// Local copy of timestamp parsing — kept here to keep the module dependency-free.
// The watcher has its own `parseTimestamp` for other purposes; both behave identically.
function parseClassifierTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

// `OvermindWorkflowStatus` is re-exported here for downstream call sites that
// used to import it transitively from overmind-watcher.ts.
export type { OvermindWorkflowStatus };
