import { buildParentOrphanedNotification } from "../overmind-notifications.js";
import type { NudgeStateService } from "../nudge-state-service.js";
import type { OvermindNotify } from "../overmind-watcher.js";
import type { OvermindService, OvermindWorkflow } from "../overmind-service.js";
import { isAgentPane, type AgentPaneKind } from "./agent-pane.js";

export type OrphanedParentKind = Extract<AgentPaneKind, "bare-bash" | "no-session">;

export interface GuardedParentNudgeDeps {
  overmindService: OvermindService;
  nudgeState?: NudgeStateService;
  notify?: OvermindNotify;
}

export interface GuardedParentNudgeResult {
  sent: boolean;
  parentSession: string;
  paneKind: AgentPaneKind;
  parent_status?: OrphanedParentKind;
}

type ParentSend = (target: string, message: string) => Promise<unknown>;

const fallbackParentOrphanedAlerts = new Set<string>();

export async function sendGuardedParentNudge(
  workflow: OvermindWorkflow,
  message: string,
  deps: GuardedParentNudgeDeps,
  send: ParentSend
): Promise<GuardedParentNudgeResult> {
  const { parentSession, resolverFailed } = resolveParentSession(workflow, deps);
  let paneKind: AgentPaneKind = "unknown";
  if (!resolverFailed) {
    try {
      paneKind = await isAgentPane(parentSession);
    } catch (error) {
      console.warn(`[overmind] parent session "${parentSession}" classification failed — sending nudge as unknown for run ${workflow.id}:`, error);
    }
  }

  if (paneKind === "bare-bash" || paneKind === "no-session") {
    await markParentOrphaned(workflow, parentSession, paneKind, deps);
    return {
      sent: false,
      parentSession,
      paneKind,
      parent_status: paneKind
    };
  }

  await send(parentSession, message);
  return { sent: true, parentSession, paneKind };
}

function resolveParentSession(
  workflow: OvermindWorkflow,
  deps: GuardedParentNudgeDeps
): { parentSession: string; resolverFailed: boolean } {
  const fallback = workflow.coordinator_session;
  const resolver = (deps.overmindService as {
    getParentSessionForWorkflow?: (id: number) => string | null;
  }).getParentSessionForWorkflow;

  if (typeof resolver !== "function") {
    return { parentSession: fallback, resolverFailed: false };
  }

  try {
    return {
      parentSession: resolver.call(deps.overmindService, workflow.id) ?? fallback,
      resolverFailed: false
    };
  } catch (error) {
    console.warn(`[overmind] parent session resolution failed for run ${workflow.id} — sending nudge to coordinator as unknown:`, error);
    return { parentSession: fallback, resolverFailed: true };
  }
}

async function markParentOrphaned(
  workflow: OvermindWorkflow,
  parentSession: string,
  paneKind: OrphanedParentKind,
  deps: GuardedParentNudgeDeps
): Promise<void> {
  deps.overmindService.update(workflow.id, { parent_status: paneKind });
  console.warn(`[overmind] parent session "${parentSession}" is ${paneKind} — suppressing nudge for run ${workflow.id}`);

  const key = String(workflow.id);
  const alreadyAlerted = deps.nudgeState
    ? deps.nudgeState.hasParentOrphanedAlerted(workflow.id)
    : fallbackParentOrphanedAlerts.has(key);
  if (alreadyAlerted) return;

  if (deps.nudgeState) {
    deps.nudgeState.markParentOrphanedAlerted(workflow.id);
  } else {
    fallbackParentOrphanedAlerts.add(key);
  }

  if (!deps.notify) return;
  try {
    await deps.notify(buildParentOrphanedNotification({
      workflow,
      parentSession,
      paneKind
    }));
  } catch (error) {
    console.error("Overmind parent-orphaned notify failed:", error);
  }
}
