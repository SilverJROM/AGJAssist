// Attributing "which session has the active turn right now" given a workflow's
// coordinator + child pane snapshots. Pure — no DB, no tmux. Extracted from
// overmind-watcher.ts in batch B4a of the modularization refactor (per DEC-002,
// kept separate from classifier.ts because the responsibility is distinct).

import { hasBusySignal } from "./pane-utils.js";

export interface ActiveSessionAttribution {
  active_session: string | null;
  active_role: "parent" | "child" | null;
}

/**
 * Walks the coordinator pane first; if it shows an active generation turn the
 * parent is the active session. Otherwise walks the child panes in order — the
 * first child with an active turn wins. Returns nulls if nothing is generating.
 */
export function determineActiveSessionAttribution(input: {
  coordinatorSession: string;
  coordinatorPane: string;
  childSessions: string[];
  childPanes: string[];
}): ActiveSessionAttribution {
  if (hasBusySignal(input.coordinatorPane)) {
    return {
      active_session: input.coordinatorSession,
      active_role: "parent"
    };
  }

  const activeChildIndex = input.childPanes.findIndex((pane) => hasBusySignal(pane));
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
