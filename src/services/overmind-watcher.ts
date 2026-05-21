import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { OvermindService, OvermindWorkflow, OvermindWorkflowStatus } from "./overmind-service.js";
import { TmuxService } from "../tmux/tmux-service.js";
import {
  BrainVerdict,
  DecisionVerdict,
  OvermindBrain,
  hasAlwaysEscalateKeyword
} from "./overmind-brain.js";
import {
  buildBlockedNotification,
  buildNeedsInputNotification
} from "./overmind-notifications.js";

export const POLL_MS = 45_000;
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
export const FRONTLOAD_CORRECTION_NOTE =
  "Overmind: that decision should have been frontloaded at intake (projcore §1.4a) — please put such decisions in the north-star next time.";

const BUSY_MARKER_RE = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;
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
  return createHash("sha256").update(pane).digest("hex");
}

export function determineActiveSessionAttribution(input: {
  coordinatorSession: string;
  coordinatorPane: string;
  childSessions: string[];
  childPanes: string[];
}): ActiveSessionAttribution {
  if (BUSY_MARKER_RE.test(input.coordinatorPane)) {
    return {
      active_session: input.coordinatorSession,
      active_role: "parent"
    };
  }

  const activeChildIndex = input.childPanes.findIndex((pane) => BUSY_MARKER_RE.test(pane));
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
    private readonly notify?: OvermindNotify,
    private readonly brain?: OvermindBrain,
    private readonly onUpdate?: OvermindUpdate
  ) {}

  async tick(): Promise<void> {
    const workflows = this.overmindService
      .list()
      .filter((workflow) => !TERMINAL_STATUSES.includes(workflow.status));

    await Promise.all(workflows.map((workflow) => this.tickWorkflow(workflow)));
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
    const activeAttribution = determineActiveSessionAttribution({
      coordinatorSession: workflow.coordinator_session,
      coordinatorPane,
      childSessions: workflow.child_sessions,
      childPanes
    });

    const nudgeFields = result.status === "awaiting_decision"
      ? await this.applyDecisionInterception(workflow, result.pendingDecision)
      : await this.applyNudgeLadder(workflow, result.status, coordinatorPane);

    this.overmindService.update(workflow.id, {
      status: nudgeFields.status ?? result.status,
      pending_decision: nudgeFields.pending_decision !== undefined
        ? nudgeFields.pending_decision
        : result.pendingDecision,
      last_pane_hash: nudgeFields.last_pane_hash ?? result.coordinatorHash,
      stuck_since: nudgeFields.stuck_since !== undefined ? nudgeFields.stuck_since : result.stuckSince,
      active_session: activeAttribution.active_session,
      active_role: activeAttribution.active_role,
      ...nudgeFields,
      ...(result.lastActivityAt ? { last_activity_at: result.lastActivityAt } : {})
    });
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
    await this.tmuxService.sendCommand(workflow.coordinator_session, CANNED_NUDGE, true, true);
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
      await this.tmuxService.sendCommand(workflow.coordinator_session, verdict.nudgeText!, true, true);
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
