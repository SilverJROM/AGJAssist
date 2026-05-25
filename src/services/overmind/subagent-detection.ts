// In-process sub-agent detection — pure pane-text predicates. Extracted from
// overmind-watcher.ts in batch B3 of the modularization refactor (2026-05-23).
// No DB, no tmux, no IO. Tests live in tests/overmind-subagent.test.ts.

// ─── In-process sub-agent suppression constants ──────────────────────────────
export const SUBAGENT_APPARENT_IDLE_BEFORE_ASK_MS = 10 * 60 * 1000; // 10 min
export const SUBAGENT_DURATION_GRACE_MS = 10 * 60 * 1000; // 10 min grace past expectedEndAt

// Tunable patterns — JROM will refine once a real sub-agent pane is captured.
// Primary (TUI inference):
//   ● Task(...)  or  ⏺ Task(...)  — Claude Code in-process Task tool invocation header
//   ● Agent(...)  or  ⏺ Agent(...)  — Claude Code in-process Agent tool invocation header
//   Running '<name>' agent  — another TUI form that may appear
// Secondary (parent-emitted explicit marker):
//   [OVERMIND] subagent <name>  — parent explicitly marks a sub-agent (also the Tier-2 ack)
export const SUBAGENT_PATTERNS: RegExp[] = [
  /^\s*[●⏺]\s*Task\(/m,
  /^\s*[●⏺]\s*Agent\(/m,
  /Running\s+'[^']+'\s+agent\b/i,
  /\[OVERMIND\]\s+subagent\s+\S+/i
];

/** Returns true if ANY sub-agent indicator pattern matches the pane text. */
export function subAgentInFlight(paneText: string): boolean {
  return SUBAGENT_PATTERNS.some((re) => re.test(paneText));
}

/** Returns true when the parent explicitly signals the sub-agent is done. */
export function paneShowsSubagentDone(paneText: string): boolean {
  return /\[OVERMIND\]\s+subagent\s+done\b/i.test(paneText);
}

/**
 * Extracts sub-agent name + optional expected minutes from the last
 * `[OVERMIND] subagent <name> ~<N>min` marker in the pane text.
 * Returns null if no match.
 */
export function parseSubagentAckFromPane(
  paneText: string
): { name: string; expectedMinutes?: number } | null {
  const re = /\[OVERMIND\]\s+subagent\s+(\S+)(?:\s+~?(\d+)\s*min)?/gi;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(paneText)) !== null) {
    last = match;
  }
  if (!last) return null;
  const name = last[1];
  const minutes = last[2] ? parseInt(last[2], 10) : undefined;
  return { name, expectedMinutes: minutes };
}
