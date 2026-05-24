import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_COMPLETION_CONSULT_TEXT,
  type CompletionVerdict,
  type OvermindBrain
} from "../overmind-brain.js";
import type {
  OvermindChildSessionStatus,
  OvermindParentStatus,
  OvermindService,
  OvermindWorkflow
} from "../overmind-service.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { ActiveSessionAttribution } from "./active-session-attribution.js";
import { collectPriorDecisions } from "./decision-match.js";
import { hashPane } from "./pane-utils.js";

const CAPTURE_LINES = 200;
const BRAIN_COORDINATOR_TAIL_LINES = 40;
const BRAIN_RUN_FILE_TAIL_LINES = 80;
const ALL_DONE_CONFIRM_NUDGE = DEFAULT_COMPLETION_CONSULT_TEXT;

export interface CompletionDetectorDeps {
  overmindService: OvermindService;
  tmuxService: TmuxService;
  brain?: OvermindBrain;
}

export async function handleAllTasksDone(
  workflow: OvermindWorkflow,
  coordinatorPane: string,
  coordinatorHash: string,
  attribution: ActiveSessionAttribution,
  parentStatus: OvermindParentStatus,
  childStatuses: OvermindChildSessionStatus[],
  resolvedRunDir: string,
  deps: CompletionDetectorDeps
): Promise<void> {
  const doneCount = workflow.tasks.filter((task) => task.state === "done").length;
  const signature = `${doneCount}/${workflow.tasks.length}`;

  if (workflow.completion_check === signature) {
    deps.overmindService.update(workflow.id, {
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

  const verdict = await assessCompletion(workflow, coordinatorPane, resolvedRunDir, deps);

  if (verdict.action === "working") {
    deps.overmindService.update(workflow.id, {
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

  let lastPaneHash = coordinatorHash;
  try {
    await deps.tmuxService.sendAndSubmit(workflow.coordinator_session, verdict.consultText!);
    lastPaneHash = hashPane(await capturePaneSafe(deps.tmuxService, workflow.coordinator_session));
  } catch (error) {
    console.error("Overmind completion consult nudge failed:", error);
  }

  deps.overmindService.update(workflow.id, {
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

async function assessCompletion(
  workflow: OvermindWorkflow,
  coordinatorPane: string,
  resolvedRunDir: string,
  deps: CompletionDetectorDeps
): Promise<CompletionVerdict> {
  if (!deps.brain?.verifyCompletion) {
    return {
      action: "consult",
      consultText: ALL_DONE_CONFIRM_NUDGE,
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
      consultText: ALL_DONE_CONFIRM_NUDGE,
      reason: "Completion brain failed; deterministic consult to projcore."
    };
  }
}

async function capturePaneSafe(tmuxService: TmuxService, target: string): Promise<string> {
  try {
    return await tmuxService.capturePane(target, CAPTURE_LINES);
  } catch {
    return "";
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
