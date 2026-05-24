import { DatabaseService } from "../db/database.js";
import {
  OvermindChildSessionStatus,
  OvermindParentStatus,
  OvermindTask,
  OvermindTaskHistoryEntry,
  OvermindTaskLogEntry,
  OvermindWorkflow,
  OvermindWorkflowStatus,
  RegisterOvermindWorkflowInput,
  RunSummary,
  UpdateOvermindWorkflowInput
} from "./overmind/types.js";
import {
  DuplicateRunDirError,
  sanitizeCurrentTask,
  sanitizeTaskList
} from "./overmind/sanitize.js";

// Types live in ./overmind/types.ts (B7). Re-exported here for public-surface
// stability per og-requirements R2.5.
export type {
  OvermindChildSessionStatus,
  OvermindChildStatus,
  OvermindParentStatus,
  OvermindTask,
  OvermindTaskHistoryEntry,
  OvermindTaskLogEntry,
  OvermindTaskState,
  OvermindWorkflow,
  OvermindWorkflowStatus,
  RegisterOvermindWorkflowInput,
  RunSummary,
  UpdateOvermindWorkflowInput
} from "./overmind/types.js";

// Sanitation + dup-run_dir guard live in ./overmind/sanitize.ts (B7).
export { DuplicateRunDirError, isTrashTaskLabel, sanitizeTaskList, sanitizeCurrentTask } from "./overmind/sanitize.js";

interface OvermindWorkflowRow {
  id: number;
  label: string;
  display_name: string | null;
  coordinator_session: string;
  child_sessions: string;
  child_roles: string;
  run_dir: string;
  status: OvermindWorkflowStatus;
  current_task: string | null;
  tasks: string;
  pending_decision: string | null;
  active_session: string | null;
  active_role: "parent" | "child" | null;
  ended_at: string | null;
  task_log: string;
  last_pane_hash: string | null;
  last_activity_at: string;
  stuck_since: string | null;
  nudge_count: number;
  tier: number;
  last_notified_transition: string | null;
  run_started_at: string | null;
  accumulated_ms: number;
  completion_check: string | null;
  parent_status: OvermindParentStatus | null;
  child_statuses: string;
  info_request: string | null;
  info_check: string | null;
  monitoring_paused: number;
  paused_at: string | null;
  paused_by: string | null;
  last_parent_update_at: string | null;
  ask_update_cooldown_override_minutes: number | null;
  created_at: string;
  updated_at: string;
}

interface OvermindTaskHistoryRow {
  id: number;
  coordinator_session: string;
  name: string;
  at: string;
  current_task: string | null;
  done: number;
  total: number;
}

// DuplicateRunDirError + isTrashTaskLabel / sanitizeTaskList / sanitizeCurrentTask
// moved to ./overmind/sanitize.ts (B7) — re-exported at top of file. Local
// imports above give the class direct access.

export class OvermindService {
  constructor(private readonly db: DatabaseService) {}

  register(input: RegisterOvermindWorkflowInput): OvermindWorkflow {
    // Same-run_dir duplicate check (see DuplicateRunDirError above). Skip terminal rows
    // so re-running the same project after completion is still allowed.
    const collision = this.db
      .prepare(
        `SELECT * FROM overmind_workflows
         WHERE run_dir = ?
           AND coordinator_session != ?
           AND status NOT IN ('completed','failed')
         LIMIT 1`
      )
      .get(input.run_dir, input.coordinator_session) as OvermindWorkflowRow | undefined;
    if (collision) {
      throw new DuplicateRunDirError(this.mapRow(collision));
    }

    const tasks = sanitizeTaskList(input.tasks);
    const currentTask = sanitizeCurrentTask(input.current_task);
    const now = this.isoNow();
    const endedAt = this.computeEndedAt(tasks, "active", null, now);
    const row = this.db
      .prepare(
        `INSERT INTO overmind_workflows (
          label,
          coordinator_session,
          child_sessions,
          child_roles,
          run_dir,
          status,
          current_task,
          tasks,
          pending_decision,
          active_session,
          active_role,
          ended_at,
          task_log,
          stuck_since,
          nudge_count,
          tier,
          last_notified_transition,
          run_started_at,
          accumulated_ms,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, ?, '[]', NULL, 0, 0, NULL, ?, 0, ?)
        ON CONFLICT(coordinator_session) DO UPDATE SET
          label = excluded.label,
          child_sessions = excluded.child_sessions,
          child_roles = CASE WHEN excluded.child_roles = '[]' THEN overmind_workflows.child_roles ELSE excluded.child_roles END,
          run_dir = excluded.run_dir,
          status = 'active',
          current_task = excluded.current_task,
          tasks = excluded.tasks,
          pending_decision = NULL,
          active_session = NULL,
          active_role = NULL,
          ended_at = excluded.ended_at,
          task_log = '[]',
          stuck_since = NULL,
          nudge_count = 0,
          tier = 0,
          last_notified_transition = NULL,
          completion_check = NULL,
          accumulated_ms = overmind_workflows.accumulated_ms + ?,
          run_started_at = excluded.run_started_at,
          updated_at = excluded.updated_at
        RETURNING *`
      )
      .get(
        input.label,
        input.coordinator_session,
        JSON.stringify(input.child_sessions ?? []),
        JSON.stringify(input.child_roles ?? []),
        input.run_dir,
        currentTask,
        JSON.stringify(tasks),
        endedAt,
        now,
        now,
        this.priorRunElapsedMs(input.coordinator_session, now)
      ) as OvermindWorkflowRow;

    this.touchParentUpdate(row.id);
    const registered = this.get(row.id);
    if (!registered) {
      throw new Error(`Failed to load workflow ${row.id} after register`);
    }
    return registered;
  }

  list(status?: OvermindWorkflowStatus): OvermindWorkflow[] {
    const rows = status
      ? this.db
          .prepare("SELECT * FROM overmind_workflows WHERE status = ? ORDER BY updated_at DESC, id DESC")
          .all(status)
      : this.db
          .prepare("SELECT * FROM overmind_workflows ORDER BY updated_at DESC, id DESC")
          .all();

    return (rows as OvermindWorkflowRow[]).map((row) => this.mapRow(row));
  }

  get(id: number): OvermindWorkflow | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_workflows WHERE id = ?")
      .get(id) as OvermindWorkflowRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getBySession(coordinatorSession: string): OvermindWorkflow | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_workflows WHERE coordinator_session = ?")
      .get(coordinatorSession) as OvermindWorkflowRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listHistory(coordinatorSession?: string): OvermindTaskHistoryEntry[] {
    const rows = coordinatorSession
      ? this.db
          .prepare(
            `SELECT
              h.id,
              h.coordinator_session,
              COALESCE(w.display_name, w.label, h.name) AS name,
              h.at,
              h.current_task,
              h.done,
              h.total
            FROM overmind_task_history h
            LEFT JOIN overmind_workflows w
              ON w.coordinator_session = h.coordinator_session
            WHERE h.coordinator_session = ?
            ORDER BY h.at DESC, h.id DESC`
          )
          .all(coordinatorSession)
      : this.db
          .prepare(
            `SELECT
              h.id,
              h.coordinator_session,
              COALESCE(w.display_name, w.label, h.name) AS name,
              h.at,
              h.current_task,
              h.done,
              h.total
            FROM overmind_task_history h
            LEFT JOIN overmind_workflows w
              ON w.coordinator_session = h.coordinator_session
            ORDER BY h.at DESC, h.id DESC`
          )
          .all();
    return (rows as OvermindTaskHistoryRow[]).map((row) => ({ ...row }));
  }

  listRuns(): RunSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, display_name, coordinator_session, status, run_started_at, ended_at, tasks
        FROM overmind_workflows
        WHERE status IN ('completed', 'failed')
        ORDER BY
          CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END,
          ended_at DESC,
          run_started_at DESC`
      )
      .all() as Array<{
        id: number;
        label: string;
        display_name: string | null;
        coordinator_session: string;
        status: OvermindWorkflowStatus;
        run_started_at: string | null;
        ended_at: string | null;
        tasks: string;
      }>;

    return rows.map((row) => {
      const tasks = this.parseJsonArray<OvermindTask>(row.tasks);
      return {
        id: row.id,
        label: row.label,
        display_name: row.display_name,
        coordinator_session: row.coordinator_session,
        status: row.status,
        run_started_at: row.run_started_at,
        ended_at: row.ended_at,
        total_tasks: tasks.length,
        done_tasks: this.countDoneTasks(tasks)
      };
    });
  }

  update(id: number, fields: UpdateOvermindWorkflowInput): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;

    const next = {
      label: fields.label ?? existing.label,
      coordinator_session: fields.coordinator_session ?? existing.coordinator_session,
      child_sessions: fields.child_sessions ?? existing.child_sessions,
      run_dir: fields.run_dir ?? existing.run_dir,
      status: fields.status ?? existing.status,
      current_task: fields.current_task !== undefined ? fields.current_task : existing.current_task,
      tasks: fields.tasks ?? existing.tasks,
      pending_decision: fields.pending_decision !== undefined ? fields.pending_decision : existing.pending_decision,
      active_session: fields.active_session !== undefined ? fields.active_session : existing.active_session,
      active_role: fields.active_role !== undefined ? fields.active_role : existing.active_role,
      last_pane_hash: fields.last_pane_hash !== undefined ? fields.last_pane_hash : existing.last_pane_hash,
      last_activity_at: fields.last_activity_at !== undefined ? fields.last_activity_at : existing.last_activity_at,
      stuck_since: fields.stuck_since !== undefined ? fields.stuck_since : existing.stuck_since,
      nudge_count: fields.nudge_count ?? existing.nudge_count,
      tier: fields.tier ?? existing.tier,
      last_notified_transition: fields.last_notified_transition !== undefined
        ? fields.last_notified_transition
        : existing.last_notified_transition,
      completion_check: fields.completion_check !== undefined
        ? fields.completion_check
        : existing.completion_check,
      parent_status: fields.parent_status !== undefined ? fields.parent_status : existing.parent_status,
      child_statuses: fields.child_statuses ?? existing.child_statuses,
      info_request: fields.info_request !== undefined ? fields.info_request : existing.info_request,
      info_check: fields.info_check !== undefined ? fields.info_check : existing.info_check
    };

    this.db
      .prepare(
        `UPDATE overmind_workflows
        SET label = ?,
            coordinator_session = ?,
            child_sessions = ?,
            run_dir = ?,
            status = ?,
            current_task = ?,
            tasks = ?,
            pending_decision = ?,
            active_session = ?,
            active_role = ?,
            last_pane_hash = ?,
            last_activity_at = ?,
            stuck_since = ?,
            nudge_count = ?,
            tier = ?,
            last_notified_transition = ?,
            completion_check = ?,
            parent_status = ?,
            child_statuses = ?,
            info_request = ?,
            info_check = ?,
            updated_at = datetime('now')
        WHERE id = ?`
      )
      .run(
        next.label,
        next.coordinator_session,
        JSON.stringify(next.child_sessions),
        next.run_dir,
        next.status,
        next.current_task,
        JSON.stringify(next.tasks),
        next.pending_decision,
        next.active_session,
        next.active_role,
        next.last_pane_hash,
        next.last_activity_at,
        next.stuck_since,
        next.nudge_count,
        next.tier,
        next.last_notified_transition,
        next.completion_check,
        next.parent_status,
        JSON.stringify(next.child_statuses),
        next.info_request,
        next.info_check,
        id
      );

    return this.get(id);
  }

  markNotificationTransition(id: number, transition: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE overmind_workflows
        SET last_notified_transition = ?, updated_at = datetime('now')
        WHERE id = ?
          AND (last_notified_transition IS NULL OR last_notified_transition != ?)`
      )
      .run(transition, id, transition);
    return result.changes > 0;
  }

  // JROM-only field — only this method may write display_name; only the JWT/owner-guarded
  // POST /api/overmind/workflows/:id/name route may call it. Do not add display_name to
  // register/update/setStatus/setTasks SQL.
  setDisplayName(id: number, name: string | null): OvermindWorkflow | null {
    const normalized = name === null ? null : name.trim();
    const displayName = normalized ? normalized : null;
    const result = this.db
      .prepare("UPDATE overmind_workflows SET display_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(displayName, id);
    if (result.changes === 0) return null;
    return this.get(id);
  }

  // JROM-initiated monitoring pause: suppresses all overmind interrupts (nudges,
  // completeness requests, brain consults, notifications) for this workflow without
  // changing its status, so the card stays visible. `by` records the initiator for awareness.
  setMonitoringPaused(id: number, paused: boolean, by: string | null): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE overmind_workflows
        SET monitoring_paused = ?,
            paused_at = ?,
            paused_by = ?,
            nudge_count = CASE WHEN ? = 1 THEN 0 ELSE nudge_count END,
            tier = CASE WHEN ? = 1 THEN 0 ELSE tier END,
            updated_at = datetime('now')
        WHERE id = ?`
      )
      .run(
        paused ? 1 : 0,
        paused ? this.isoNow() : null,
        paused ? by : null,
        paused ? 1 : 0,
        paused ? 1 : 0,
        id
      );
    this.touchParentUpdate(id);
    return this.get(id);
  }

  setStatus(
    id: number,
    status: OvermindWorkflowStatus,
    options?: { touchParentUpdate?: boolean }
  ): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    const endedAt = this.computeEndedAt(existing.tasks, status, existing.ended_at);

    this.db
      .prepare("UPDATE overmind_workflows SET status = ?, ended_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, endedAt, id);
    if (options?.touchParentUpdate === true) {
      this.touchParentUpdate(id);
    }
    return this.get(id);
  }

  setTasks(id: number, currentTask: string | null, tasks: OvermindTask[]): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    // Same defensive filter as register — strips markdown table chrome ("| # | Batch | …"
    // and "|---|---|") and empty labels before persisting. Callers that accidentally
    // pipe a queue.md through line-by-line stop polluting the dashboard.
    tasks = sanitizeTaskList(tasks);
    currentTask = sanitizeCurrentTask(currentTask);
    const now = this.isoNow();
    const doneCount = this.countDoneTasks(tasks);
    const existingDoneCount = this.countDoneTasks(existing.tasks);
    const shouldLog = currentTask !== existing.current_task || doneCount !== existingDoneCount;
    const taskLog = shouldLog
      ? [
          ...existing.task_log,
          {
            at: now,
            current_task: currentTask,
            done: doneCount,
            total: tasks.length,
            note: this.taskLogNote(existing.current_task, currentTask, existingDoneCount, doneCount)
          }
        ].slice(-50)
      : existing.task_log;
    const endedAt = this.computeEndedAt(tasks, existing.status, existing.ended_at, now);

    const tx = this.db.raw.transaction(() => {
      this.db
        .prepare("UPDATE overmind_workflows SET current_task = ?, tasks = ?, ended_at = ?, task_log = ?, updated_at = datetime('now') WHERE id = ?")
        .run(currentTask, JSON.stringify(tasks), endedAt, JSON.stringify(taskLog), id);

      if (shouldLog) {
        this.db
          .prepare(
            `INSERT INTO overmind_task_history (
              coordinator_session,
              name,
              at,
              current_task,
              done,
              total
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            existing.coordinator_session,
            existing.display_name || existing.label,
            now,
            currentTask,
            doneCount,
            tasks.length
          );
      }
    });
    tx();
    this.touchParentUpdate(id);
    return this.get(id);
  }

  setAskUpdateCooldownOverride(id: number, minutes: number | null): OvermindWorkflow | null {
    if (minutes !== null) {
      if (
        !Number.isInteger(minutes) ||
        minutes < 5 ||
        minutes > 240 ||
        minutes % 5 !== 0
      ) {
        throw new Error("ask_update_cooldown_override_minutes must be null or an integer multiple of 5 between 5 and 240");
      }
    }
    const result = this.db
      .prepare(
        "UPDATE overmind_workflows SET ask_update_cooldown_override_minutes = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(minutes, id);
    if (result.changes === 0) return null;
    return this.get(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM overmind_workflows WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private mapRow(row: OvermindWorkflowRow): OvermindWorkflow {
    return {
      ...row,
      monitoring_paused: row.monitoring_paused === 1,
      child_sessions: this.parseJsonArray<string>(row.child_sessions),
      child_roles: this.parseJsonArray<string>(row.child_roles),
      tasks: this.parseJsonArray<OvermindTask>(row.tasks),
      task_log: this.parseJsonArray<OvermindTaskLogEntry>(row.task_log),
      child_statuses: this.parseJsonArray<OvermindChildSessionStatus>(row.child_statuses)
    };
  }

  private parseJsonArray<T>(value: string): T[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  }

  private countDoneTasks(tasks: OvermindTask[]): number {
    return tasks.filter((task) => task.state === "done").length;
  }

  private taskLogNote(previousTask: string | null, currentTask: string | null, previousDone: number, done: number): string {
    if (previousTask !== currentTask && previousDone !== done) return "current task and progress changed";
    if (previousTask !== currentTask) return "current task changed";
    return "progress changed";
  }

  private computeEndedAt(
    tasks: OvermindTask[],
    status: OvermindWorkflowStatus,
    previousEndedAt: string | null,
    now = this.isoNow()
  ): string | null {
    if (tasks.some((task) => task.state !== "done")) return null;
    if ((tasks.length > 0 && tasks.every((task) => task.state === "done")) || status === "completed") {
      return previousEndedAt ?? now;
    }
    return previousEndedAt;
  }

  private priorRunElapsedMs(coordinatorSession: string, now: string): number {
    const existing = this.db
      .prepare(
        "SELECT run_started_at, created_at, ended_at FROM overmind_workflows WHERE coordinator_session = ?"
      )
      .get(coordinatorSession) as
      | { run_started_at: string | null; created_at: string | null; ended_at: string | null }
      | undefined;
    if (!existing) return 0;

    const start = this.parseTimestampMs(existing.run_started_at ?? existing.created_at);
    const end = this.parseTimestampMs(existing.ended_at ?? now);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
    return end - start;
  }

  private parseTimestampMs(value: string | null): number {
    if (!value) return NaN;
    return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value);
  }

  private touchParentUpdate(workflowId: number): void {
    this.db
      .prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?")
      .run(this.isoNow(), workflowId);
  }

  private isoNow(): string {
    return new Date().toISOString();
  }
}
