// Server-side sanitation for incoming /register and /tasks payloads — strips
// markdown table chrome and rejects same-run_dir collisions. Extracted from
// overmind-service.ts in batch B7 of the modularization refactor (2026-05-23).
// Originally landed earlier the same day as the dup-run_dir + trash-tasklist
// bug fix (commit d10f1d6).

import { OvermindTask, OvermindWorkflow } from "./types.js";

// Thrown by `register` when another non-terminal workflow already owns the same
// `run_dir` under a different `coordinator_session`. Enforces JROM's
// "1 workflow per parent session" rule — a parent that renamed its tmux session
// must close the old workflow before re-registering, instead of silently
// spawning a duplicate row (e.g. the hris-d-22 / hris-claude-main twins on
// 2026-05-23).
export class DuplicateRunDirError extends Error {
  constructor(public readonly existing: OvermindWorkflow) {
    super(
      `Workflow already registered as coordinator_session='${existing.coordinator_session}' (id=${existing.id}) for run_dir='${existing.run_dir}'. ` +
        `One workflow per parent session — reuse the existing session or POST /api/overmind/complete on it first.`
    );
    this.name = "DuplicateRunDirError";
  }
}

// Recognises markdown table chrome that callers sometimes paste as task labels
// when they naively line-scan a queue.md (header `| # | Batch | ... |` and the
// `|---|---|...|` separator). Conservative — only the obviously-structural lines
// are dropped; legit short labels containing pipes still pass.
const TABLE_SEPARATOR_RE = /^[\s|\-:=_*]+$/;
const TABLE_HEADER_RE = /^\s*\|\s*#\s*\|/i;

export function isTrashTaskLabel(label: string | null | undefined): boolean {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return true;
  if (TABLE_SEPARATOR_RE.test(trimmed)) return true;
  if (TABLE_HEADER_RE.test(trimmed)) return true;
  return false;
}

export function sanitizeTaskList(tasks: OvermindTask[] | undefined): OvermindTask[] {
  return (tasks ?? []).filter((t) => !isTrashTaskLabel(t?.label));
}

export function sanitizeCurrentTask(current: string | null | undefined): string | null {
  if (current == null) return null;
  return isTrashTaskLabel(current) ? null : current;
}
