import { DatabaseService } from "../db/database.js";

export type OvermindWorkflowStatus =
  | "active"
  | "working"
  | "waiting_human"
  | "awaiting_decision"
  | "stuck"
  | "paused"
  | "completed"
  | "failed";

export type OvermindTaskState = "done" | "processing" | "pending";

export interface OvermindTask {
  id: string;
  label: string;
  state: OvermindTaskState;
}

export interface OvermindWorkflow {
  id: number;
  label: string;
  coordinator_session: string;
  child_sessions: string[];
  run_dir: string;
  status: OvermindWorkflowStatus;
  current_task: string | null;
  tasks: OvermindTask[];
  pending_decision: string | null;
  active_session: string | null;
  active_role: "parent" | "child" | null;
  last_pane_hash: string | null;
  last_activity_at: string;
  stuck_since: string | null;
  nudge_count: number;
  tier: number;
  created_at: string;
  updated_at: string;
}

export interface RegisterOvermindWorkflowInput {
  label: string;
  coordinator_session: string;
  child_sessions?: string[];
  run_dir: string;
  current_task?: string | null;
  tasks?: OvermindTask[];
}

export interface UpdateOvermindWorkflowInput {
  label?: string;
  coordinator_session?: string;
  child_sessions?: string[];
  run_dir?: string;
  status?: OvermindWorkflowStatus;
  current_task?: string | null;
  tasks?: OvermindTask[];
  pending_decision?: string | null;
  active_session?: string | null;
  active_role?: "parent" | "child" | null;
  last_pane_hash?: string | null;
  last_activity_at?: string | null;
  stuck_since?: string | null;
  nudge_count?: number;
  tier?: number;
}

interface OvermindWorkflowRow {
  id: number;
  label: string;
  coordinator_session: string;
  child_sessions: string;
  run_dir: string;
  status: OvermindWorkflowStatus;
  current_task: string | null;
  tasks: string;
  pending_decision: string | null;
  active_session: string | null;
  active_role: "parent" | "child" | null;
  last_pane_hash: string | null;
  last_activity_at: string;
  stuck_since: string | null;
  nudge_count: number;
  tier: number;
  created_at: string;
  updated_at: string;
}

export class OvermindService {
  constructor(private readonly db: DatabaseService) {}

  register(input: RegisterOvermindWorkflowInput): OvermindWorkflow {
    const row = this.db
      .prepare(
        `INSERT INTO overmind_workflows (
          label,
          coordinator_session,
          child_sessions,
          run_dir,
          status,
          current_task,
          tasks,
          pending_decision,
          active_session,
          active_role,
          stuck_since,
          nudge_count,
          tier,
          updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, NULL, 0, 0, datetime('now'))
        ON CONFLICT(coordinator_session) DO UPDATE SET
          label = excluded.label,
          child_sessions = excluded.child_sessions,
          run_dir = excluded.run_dir,
          status = 'active',
          current_task = excluded.current_task,
          tasks = excluded.tasks,
          pending_decision = NULL,
          active_session = NULL,
          active_role = NULL,
          stuck_since = NULL,
          nudge_count = 0,
          tier = 0,
          updated_at = datetime('now')
        RETURNING *`
      )
      .get(
        input.label,
        input.coordinator_session,
        JSON.stringify(input.child_sessions ?? []),
        input.run_dir,
        input.current_task ?? null,
        JSON.stringify(input.tasks ?? [])
      ) as OvermindWorkflowRow;

    return this.mapRow(row);
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
      tier: fields.tier ?? existing.tier
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
        id
      );

    return this.get(id);
  }

  setStatus(id: number, status: OvermindWorkflowStatus): OvermindWorkflow | null {
    this.db
      .prepare("UPDATE overmind_workflows SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id);
    return this.get(id);
  }

  setTasks(id: number, currentTask: string | null, tasks: OvermindTask[]): OvermindWorkflow | null {
    this.db
      .prepare("UPDATE overmind_workflows SET current_task = ?, tasks = ?, updated_at = datetime('now') WHERE id = ?")
      .run(currentTask, JSON.stringify(tasks), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM overmind_workflows WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private mapRow(row: OvermindWorkflowRow): OvermindWorkflow {
    return {
      ...row,
      child_sessions: this.parseJsonArray<string>(row.child_sessions),
      tasks: this.parseJsonArray<OvermindTask>(row.tasks)
    };
  }

  private parseJsonArray<T>(value: string): T[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  }
}
