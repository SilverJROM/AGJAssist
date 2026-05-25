import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AppSettingsService } from "../app-settings-service.js";
import type {
  BrainVerdict,
  DecisionVerdict,
  OvermindBrain
} from "../overmind-brain.js";
import {
  buildBlockedNotification,
  buildNeedsInputNotification
} from "../overmind-notifications.js";
import type { NudgeStateService } from "../nudge-state-service.js";
import type { OvermindService, OvermindWorkflow, OvermindWorkflowStatus } from "../overmind-service.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { ClassifyResult } from "./classifier.js";
import {
  applyAlwaysEscalateGuardrail,
  checkedContextLine,
  collectPriorDecisions
} from "./decision-match.js";
import { hashPane } from "./pane-utils.js";
import type { WatcherCooldowns } from "./cooldowns.js";
import type { OvermindNotify } from "../overmind-watcher.js";

const CAPTURE_LINES = 200;
const MAX_CANNED_NUDGES = 2;
const BRAIN_COORDINATOR_TAIL_LINES = 40;
const BRAIN_RUN_FILE_TAIL_LINES = 80;
const DECISION_HANDLED_TIER = 4;
const CANNED_NUDGE =
  "Overmind: you appear idle — check your implementer pane / callbacks.md and route the current batch, or report STATUS.";
const CANNED_NUDGE_NO_CHILD =
  "Overmind: you appear idle — are you actually idle, or do you have an unregistered child session? If you spawned one, please register it (POST /api/overmind/register with the updated child_sessions + child_roles). Otherwise resume work or report STATUS.";
const FRONTLOAD_CORRECTION_NOTE =
  "Overmind: that decision should have been frontloaded at intake (projcore §1.4a) — please put such decisions in the north-star next time.";

export interface NudgeLadderFields {
  nudge_count: number;
  tier: number;
  status?: OvermindWorkflowStatus;
  last_pane_hash?: string;
  stuck_since?: string | null;
  pending_decision?: string | null;
}

export interface NudgeLadderDeps {
  overmindService: OvermindService;
  tmuxService: TmuxService;
  brain?: OvermindBrain;
  appSettings?: AppSettingsService;
  nudgeState?: NudgeStateService;
  cooldowns: WatcherCooldowns;
  notify?: OvermindNotify;
}

export async function applyNudgeLadder(
  workflow: OvermindWorkflow,
  status: ClassifyResult["status"],
  coordinatorPane: string,
  deps: NudgeLadderDeps
): Promise<NudgeLadderFields> {
  if (status === "working") {
    return { nudge_count: 0, tier: 0 };
  }

  if (status === "waiting_human") {
    if (!deps.brain || workflow.tier >= 3) {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }
    return applyTier3Brain(workflow, coordinatorPane, deps);
  }

  if (status !== "stuck") {
    return { nudge_count: workflow.nudge_count, tier: workflow.tier };
  }

  if (workflow.nudge_count >= MAX_CANNED_NUDGES) {
    if (!deps.brain || workflow.tier >= 3) {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }
    return applyTier3Brain(workflow, coordinatorPane, deps);
  }

  if (workflow.tier >= 3) {
    return { nudge_count: workflow.nudge_count, tier: workflow.tier };
  }

  if (deps.appSettings) {
    const idleCooldownMs = deps.appSettings.get().stuck_nudge_cooldown_minutes * 60_000;
    const nowMs = Date.now();
    const lastIdleNudge = getLastUnifiedIdleNudgeAt(workflow.id, deps.cooldowns, deps.nudgeState);
    if (nowMs - lastIdleNudge < idleCooldownMs) {
      return { nudge_count: workflow.nudge_count, tier: workflow.tier };
    }
  }

  const nextNudgeCount = workflow.nudge_count + 1;
  const nudgeText = (workflow.child_sessions?.length ?? 0) === 0 ? CANNED_NUDGE_NO_CHILD : CANNED_NUDGE;
  await deps.tmuxService.sendAndSubmit(workflow.coordinator_session, nudgeText);
  const sendTs = Date.now();
  deps.cooldowns.recordFired(workflow.id, "unified_idle_nudge", sendTs);
  deps.nudgeState?.setLastUnifiedIdleNudge(workflow.id, sendTs);
  const postNudgePane = await capturePaneSafe(deps.tmuxService, workflow.coordinator_session);
  return {
    nudge_count: nextNudgeCount,
    tier: nextNudgeCount,
    last_pane_hash: hashPane(postNudgePane)
  };
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

export async function applyDecisionInterception(
  workflow: OvermindWorkflow,
  pendingDecision: string | null,
  deps: NudgeLadderDeps
): Promise<NudgeLadderFields> {
  if (!pendingDecision) {
    return { nudge_count: workflow.nudge_count, tier: workflow.tier };
  }

  if (workflow.tier >= DECISION_HANDLED_TIER && workflow.pending_decision === pendingDecision) {
    return { nudge_count: workflow.nudge_count, tier: workflow.tier };
  }

  let verdict: DecisionVerdict;
  try {
    if (!deps.brain) {
      throw new Error("decision brain unavailable");
    }
    verdict = await deps.brain.answerDecision({
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
  await logDecisionCorrection(workflow, pendingDecision, guardedVerdict);

  if (guardedVerdict.action === "answer") {
    await deps.tmuxService.sendCommand(workflow.coordinator_session, guardedVerdict.answerText!, true, true);
    await deps.tmuxService.sendCommand(workflow.coordinator_session, FRONTLOAD_CORRECTION_NOTE, true, true);
    const postDecisionPane = await capturePaneSafe(deps.tmuxService, workflow.coordinator_session);
    return {
      nudge_count: workflow.nudge_count,
      tier: DECISION_HANDLED_TIER,
      pending_decision: pendingDecision,
      last_pane_hash: hashPane(postDecisionPane)
    };
  }

  await notifyDecisionEscalation(workflow, pendingDecision, guardedVerdict.reason, deps);
  return {
    nudge_count: workflow.nudge_count,
    tier: DECISION_HANDLED_TIER,
    pending_decision: pendingDecision,
    status: "awaiting_decision",
    stuck_since: null
  };
}

async function applyTier3Brain(
  workflow: OvermindWorkflow,
  coordinatorPane: string,
  deps: NudgeLadderDeps
): Promise<NudgeLadderFields> {
  let verdict: BrainVerdict;
  try {
    verdict = await deps.brain!.analyzeStuck({
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
    await deps.tmuxService.sendAndSubmit(workflow.coordinator_session, verdict.nudgeText!);
    const postNudgePane = await capturePaneSafe(deps.tmuxService, workflow.coordinator_session);
    return {
      nudge_count: workflow.nudge_count,
      tier: 3,
      last_pane_hash: hashPane(postNudgePane)
    };
  }

  await notifyBlocked(workflow, tailLines(coordinatorPane, 12), verdict.reason, deps);
  return {
    nudge_count: workflow.nudge_count,
    tier: 3,
    status: "waiting_human",
    stuck_since: null
  };
}

async function notifyBlocked(
  workflow: OvermindWorkflow,
  issue: string,
  reason: string,
  deps: NudgeLadderDeps
): Promise<void> {
  await notifyTransition(
    workflow,
    `blocked:${hashShort(`${issue}\n${reason}`)}`,
    buildBlockedNotification({
      workflow,
      issue,
      checked: checkedContextLine(),
      reason
    }),
    deps
  );
}

async function notifyDecisionEscalation(
  workflow: OvermindWorkflow,
  pendingDecision: string,
  reason: string,
  deps: NudgeLadderDeps
): Promise<void> {
  await notifyTransition(
    workflow,
    `decision:${hashShort(`${pendingDecision}\n${reason}`)}`,
    buildNeedsInputNotification({
      workflow,
      issue: pendingDecision,
      checked: checkedContextLine(),
      reason
    }),
    deps
  );
}

async function notifyTransition(
  workflow: OvermindWorkflow,
  transition: string,
  text: string,
  deps: NudgeLadderDeps
): Promise<void> {
  if (!deps.overmindService.markNotificationTransition(workflow.id, transition)) return;
  if (!deps.notify) return;
  try {
    await deps.notify(text);
  } catch (error) {
    console.error("Overmind notify failed:", error);
  }
}

async function logDecisionCorrection(
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

async function capturePaneSafe(tmuxService: TmuxService, target: string): Promise<string> {
  try {
    return await tmuxService.capturePane(target, CAPTURE_LINES);
  } catch {
    return "";
  }
}

function hashShort(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
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
