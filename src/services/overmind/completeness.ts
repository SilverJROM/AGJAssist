// Deterministic registration/data-completeness assessment for an overmind
// workflow. Pure — no DB, no tmux, no IO. The watcher feeds in workflow fields +
// derived pane-text/run-dir signals; this function says what's missing and
// produces the canned coordinator-pane request line(s).
//
// Extracted from overmind-watcher.ts in batch B5 of the modularization
// refactor (2026-05-23). Tests live in tests/overmind-completeness.test.ts.

// Grace before nagging about an empty tasklist — a freshly-registered run may
// push its tasks a beat after register. Past this, an empty tasklist is a
// genuine omission.
export const EMPTY_TASKLIST_GRACE_MS = 60_000;
// How long the parent can go without any /api/overmind/tasks update before it's
// flagged as "stale" — catches Lokalcamp-style silent runs where /complete was
// never called.
export const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface CompletenessInput {
  tasks: { state: string }[];
  childSessions: string[];
  childRoles: string[];
  childStatuses: { session: string; status: string }[];
  /** The workflow's coordinator_session name (for the dead-coord error text). */
  coordinatorSession: string;
  /** False when `tmux has-session -t coordinator_session` failed — i.e. the
   *  parent tmux session that owns this workflow does not exist. */
  coordinatorSessionExists: boolean;
  runDir: string;
  runDirExists: boolean;
  ageMs: number;
  currentTask: string | null;
  // For stale detection: ISO timestamp of the run start, last task_log entry,
  // and current time.
  runStartedAt: string | null;
  taskLogLastAt: string | null;
  nowMs: number;
  // Optional: derived task state from progress.md / callbacks.md / pane text.
  // Keys are task ids; values are the inferred state. Only ids with a match are
  // present.
  derivedTaskState?: Record<string, "done" | "in-progress" | "unknown">;
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

// Deterministic registration/data completeness check (the ~90%). Pure: no I/O.
// The caller runs this only for live, not-all-done workflows. Each gap maps to
// a canned ask aimed at the coordinator (projcore), NOT JROM. `needsBrain`
// flags the residual inconsistent case.
export function assessRegistrationCompleteness(input: CompletenessInput): CompletenessResult {
  const missing: string[] = [];
  const labels: string[] = [];
  const lines: string[] = [];

  // JROM 2026-05-24: when the coordinator tmux session itself is dead, no
  // amount of nudging will reach a parent — surface this as a high-visibility
  // gap so JROM sees it on the dashboard and can re-point or /complete.
  // Watcher uses this signal to skip the nudge ladder entirely (no point
  // sending tmux messages to a non-existent target).
  if (!input.coordinatorSessionExists) {
    missing.push("coordinator_dead");
    labels.push("coord session dead");
    lines.push(
      `your coordinator tmux session '${input.coordinatorSession}' is not alive — overmind cannot reach this workflow. ` +
        `Either re-register with the correct coordinator_session, or POST /api/overmind/complete if the run is finished.`
    );
  }

  if (input.tasks.length === 0 && input.ageMs >= EMPTY_TASKLIST_GRACE_MS) {
    missing.push("tasklist");
    labels.push("tasklist");
    lines.push("push your batch tasklist — it is empty, so the dashboard shows 0/0 (build it from queue.md or your batch plan / req-matrix.md)");
  }

  // JROM 2026-05-24: trash-tasklist detector. Some callers pipe a queue.md
  // line-by-line into POST /tasks, producing labels like
  //   "1. ~~**B1** — math_validation.py rewrite + new tests · R1 + R6-slice · SHORT 30min~~ ✅ DONE 2026-05-24T00:21Z (R1 VERIFI"
  // and auto-generated IDs like "row-1", "row-2" — unreadable on the dashboard.
  // Detect and demand a clean structured tasklist.
  const trashSignals = detectTrashTasklist(input.tasks as Array<{ id?: string; label?: string; state?: string }>);
  if (trashSignals.isTrash) {
    missing.push("trash_tasklist");
    labels.push("trash tasklist");
    lines.push(
      `your tasklist looks like raw queue.md prose — ${trashSignals.reasons.join("; ")}. ` +
        `Re-POST /api/overmind/tasks with a CLEAN structured list: each task = { id: short token like "B1"/"R3", label: clean short title (no markdown strikethrough, no embedded DONE/✅ markers, no R-row dump, ≤120 chars), state: "done"|"processing"|"pending" }. Track done-ness via the state field, NOT by editing the label.`
    );
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

  // JROM 2026-05-24 lazy-supervisor fix: the previous 'tasks_stale' branch
  // nagged the parent to POST /tasks for the same staleIds we already derived
  // from progress.md / callbacks.md. That was structurally lazy — supervisor
  // asking the worker to restate what the supervisor already knows.
  //
  // The watcher now auto-promotes derivedTaskState='done' tasks BEFORE
  // calling assessRegistrationCompleteness, so by the time we get here the
  // registered state already matches the evidence. No 'tasks_stale' gap to
  // flag. derivedTaskState is still passed in (and could be reintroduced for
  // a different policy later), but for now it has no effect on the result.

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

  // Signature: sorted missing keys. (Used to dedupe re-asks — same gap set
  // means we already asked.) The old `tasks_stale` suffix is gone with the
  // auto-promote fix above.
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

/**
 * Trash-tasklist detector. Heuristic signals that a tasklist was constructed by
 * pasting queue.md / batch-plan prose lines verbatim instead of building a
 * structured list. Triggers when ANY of these high-confidence signs fire:
 *
 *   - >50% of task IDs match `^row-\d+$` (auto-generated row IDs from a
 *     naive line-by-line parse).
 *   - >40% of labels contain markdown strikethrough `~~...~~` (used in
 *     queue.md to mark tasks done — should be reflected in state, not label).
 *   - >40% of labels embed a DONE/✅ marker (same reason).
 *   - any label exceeds 200 characters (a task title is not a paragraph).
 *
 * Returns the offenders so the corrective message can name them.
 */
export function detectTrashTasklist(
  tasks: Array<{ id?: string; label?: string; state?: string }>
): { isTrash: boolean; reasons: string[] } {
  if (tasks.length === 0) return { isTrash: false, reasons: [] };
  const reasons: string[] = [];
  const total = tasks.length;
  const autoIds = tasks.filter((t) => typeof t.id === "string" && /^row-\d+$/i.test(t.id)).length;
  const strikethrough = tasks.filter(
    (t) => typeof t.label === "string" && /~~[^~]+~~/.test(t.label)
  ).length;
  const embeddedDone = tasks.filter(
    (t) => typeof t.label === "string" && /\b(DONE|✅)\b/.test(t.label)
  ).length;
  const overlong = tasks.filter((t) => typeof t.label === "string" && t.label.length > 200);

  if (autoIds / total > 0.5) {
    reasons.push(`${autoIds}/${total} task ids are auto-generated 'row-N' tokens`);
  }
  if (strikethrough / total > 0.4) {
    reasons.push(`${strikethrough}/${total} labels contain markdown strikethrough '~~…~~'`);
  }
  if (embeddedDone / total > 0.4) {
    reasons.push(`${embeddedDone}/${total} labels embed DONE/✅ markers (use the state field instead)`);
  }
  if (overlong.length > 0) {
    reasons.push(`${overlong.length} label(s) exceed 200 chars (a task title is not a paragraph)`);
  }

  return { isTrash: reasons.length > 0, reasons };
}
