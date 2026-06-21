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
  liveResolver?: (stored: string) => Promise<string>;
}

export interface GuardedParentNudgeResult {
  sent: boolean;
  parentSession: string;
  paneKind: AgentPaneKind;
  parent_status?: OrphanedParentKind;
}

type ParentSend = (target: string, message: string) => Promise<unknown>;

const fallbackParentOrphanedAlerts = new Set<string>();

/** H7: require N consecutive bare-bash/no-session reads before orphaning.
 *  A single ambiguous classification → treat as "unknown" → still nudge. */
const CONSECUTIVE_DEAD_BEFORE_ORPHAN = 2;
const consecutiveDeadCount = new Map<number, number>();

export async function sendGuardedParentNudge(
  workflow: OvermindWorkflow,
  message: string,
  deps: GuardedParentNudgeDeps,
  send: ParentSend
): Promise<GuardedParentNudgeResult> {
  const initial = resolveParentSession(workflow, deps);
  let parentSession = initial.parentSession;
  const resolverFailed = initial.resolverFailed;
  if (deps.liveResolver && !resolverFailed) {
    try {
      parentSession = await deps.liveResolver(parentSession);
    } catch {
      /* keep stored */
    }
  }
  let paneKind: AgentPaneKind = "unknown";
  if (!resolverFailed) {
    try {
      paneKind = await isAgentPane(parentSession);
    } catch (error) {
      console.warn(`[overmind] parent session "${parentSession}" classification failed — sending nudge as unknown for run ${workflow.id}:`, error);
    }
  }

  if (paneKind === "bare-bash" || paneKind === "no-session") {
    // H7: require CONSECUTIVE_DEAD_BEFORE_ORPHAN consecutive dead reads before
    // treating the parent as unreachable. A single bare-bash read of an idle
    // agent shell is ambiguous — keep nudging.
    const prev = consecutiveDeadCount.get(workflow.id) ?? 0;
    const next = prev + 1;
    consecutiveDeadCount.set(workflow.id, next);

    if (next < CONSECUTIVE_DEAD_BEFORE_ORPHAN) {
      // Single ambiguous read — downgrade to "unknown" and still attempt send.
      // (The send may fail if the session is truly dead, but we tried.)
      console.info(`[overmind] parent session "${parentSession}" read as ${paneKind} (count=${next}/${CONSECUTIVE_DEAD_BEFORE_ORPHAN}) — treating as unknown, attempting nudge.`);
      try {
        await send(parentSession, message);
        return { sent: true, parentSession, paneKind: "unknown" };
      } catch {
        // Session truly unreachable — fall through to orphan on next consecutive check.
        return { sent: false, parentSession, paneKind: "unknown" };
      }
    }

    // Threshold reached → orphan.
    consecutiveDeadCount.delete(workflow.id);
    await markParentOrphaned(workflow, parentSession, paneKind, deps);
    return {
      sent: false,
      parentSession,
      paneKind,
      parent_status: paneKind
    };
  }

  // Alive session — reset consecutive dead counter.
  consecutiveDeadCount.delete(workflow.id);
  const sent = Boolean(await send(parentSession, message));
  return { sent, parentSession, paneKind };
}

/** Clears the consecutive dead counter for a workflow (e.g. on cleanup). */
export function forgetConsecutiveDeadCount(workflowId: number): void {
  consecutiveDeadCount.delete(workflowId);
}

/** Clears ALL consecutive dead counters (e.g. for test isolation). */
export function resetAllConsecutiveDeadCounts(): void {
  consecutiveDeadCount.clear();
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
