// Server-side sanitation for incoming /register and /tasks payloads — strips
// markdown table chrome. Extracted from overmind-service.ts in batch B7 of the
// modularization refactor (2026-05-23).

import { OvermindTask, OvermindTaskState } from "./types.js";

// Recognises markdown table chrome that callers sometimes paste as task labels
// when they naively line-scan a queue.md (header `| # | Batch | ... |` and the
// `|---|---|...|` separator). Conservative — only the obviously-structural lines
// are dropped; legit short labels containing pipes still pass.
const TABLE_SEPARATOR_RE = /^[\s|\-:=_*]+$/;
const TABLE_HEADER_RE = /^\s*\|\s*#\s*\|/i;
const GARBAGE_TASK_ID_RE = /^row-\d+$/;
const VALID_TASK_STATES = new Set<OvermindTaskState>(["done", "processing", "pending"]);
export const MAX_TASK_LABEL_LENGTH = 120;

export interface InvalidOvermindTask {
  index: number;
  field: "id" | "label" | "state" | "task";
  reason: string;
  value?: unknown;
}

export interface TaskListValidation {
  ok: boolean;
  tasks: OvermindTask[];
  invalid_tasks: InvalidOvermindTask[];
}

export function isTrashTaskLabel(label: string | null | undefined): boolean {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return true;
  if (TABLE_SEPARATOR_RE.test(trimmed)) return true;
  if (TABLE_HEADER_RE.test(trimmed)) return true;
  return false;
}

function normalizeEstimateMin(value: unknown): number | null {
  return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : null;
}

function normalizeActualMin(value: unknown): number | null {
  return Number.isInteger(value) && typeof value === "number" && value >= 0 ? value : null;
}

function normalizeStartedAt(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function sanitizeTaskList(tasks: OvermindTask[] | undefined): OvermindTask[] {
  return (tasks ?? [])
    .filter((t) => !isTrashTaskLabel(t?.label))
    .map((task) => ({
      ...task,
      estimate_min: normalizeEstimateMin(task?.estimate_min),
      actual_min: normalizeActualMin(task?.actual_min),
      started_at: normalizeStartedAt(task?.started_at)
    }));
}

export function sanitizeCurrentTask(current: string | null | undefined): string | null {
  if (current == null) return null;
  return isTrashTaskLabel(current) ? null : current;
}

export function isGarbageTaskId(id: string | null | undefined): boolean {
  return GARBAGE_TASK_ID_RE.test((id ?? "").trim());
}

export function validateSubmittedTaskList(tasks: unknown): TaskListValidation {
  if (!Array.isArray(tasks)) {
    return {
      ok: false,
      tasks: [],
      invalid_tasks: [{
        index: -1,
        field: "task",
        reason: "tasks must be an array",
        value: tasks
      }]
    };
  }

  const validTasks: OvermindTask[] = [];
  const invalidTasks: InvalidOvermindTask[] = [];

  tasks.forEach((task, index) => {
    if (!task || typeof task !== "object") {
      invalidTasks.push({
        index,
        field: "task",
        reason: "task must be an object",
        value: task
      });
      return;
    }

    const t = task as { id?: unknown; label?: unknown; state?: unknown; estimate_min?: unknown; started_at?: unknown };
    if (typeof t.id !== "string" || !t.id.trim()) {
      invalidTasks.push({
        index,
        field: "id",
        reason: "id must be a non-empty string",
        value: t.id
      });
    } else if (isGarbageTaskId(t.id)) {
      invalidTasks.push({
        index,
        field: "id",
        reason: "id must be a real queue/task identifier, not the row-N parser fallback",
        value: t.id
      });
    }

    if (typeof t.label !== "string" || !t.label.trim()) {
      invalidTasks.push({
        index,
        field: "label",
        reason: "label must be a non-empty string",
        value: t.label
      });
    } else if (t.label.trim().length > MAX_TASK_LABEL_LENGTH) {
      invalidTasks.push({
        index,
        field: "label",
        reason: "label must be 120 characters or fewer",
        value: t.label
      });
    } else if (isTrashTaskLabel(t.label)) {
      invalidTasks.push({
        index,
        field: "label",
        reason: "label looks like markdown table chrome, not a task",
        value: t.label
      });
    }

    if (typeof t.state !== "string" || !VALID_TASK_STATES.has(t.state as OvermindTaskState)) {
      invalidTasks.push({
        index,
        field: "state",
        reason: "state must be one of done|processing|pending",
        value: t.state
      });
    }

    if (invalidTasks.some((invalid) => invalid.index === index)) return;
    const id = t.id as string;
    const label = t.label as string;
    const state = t.state as OvermindTaskState;
    validTasks.push({
      id: id.trim(),
      label: label.trim(),
      state,
      estimate_min: normalizeEstimateMin(t.estimate_min),
      actual_min: null,
      started_at: normalizeStartedAt(t.started_at)
    });
  });

  return {
    ok: invalidTasks.length === 0,
    tasks: validTasks,
    invalid_tasks: invalidTasks
  };
}
