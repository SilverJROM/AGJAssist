// Server-side sanitation for incoming /register and /tasks payloads — strips
// markdown table chrome. Extracted from overmind-service.ts in batch B7 of the
// modularization refactor (2026-05-23).

import { OvermindTask } from "./types.js";

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
