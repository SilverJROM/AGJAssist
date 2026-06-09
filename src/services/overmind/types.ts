// Pure type/interface declarations for overmind workflows. Extracted from
// overmind-service.ts in batch B7 of the modularization refactor (2026-05-23).
// Importing from here gets you the shape without dragging in the OvermindService
// class + better-sqlite3.

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
export type OvermindRegisterParentStatus = "ok" | "bare-bash" | "no-session" | "unknown";
export type OvermindParentStatus =
  | "working"
  | "idle"
  | "waiting_human"
  | "awaiting_decision"
  | "stuck"
  | OvermindRegisterParentStatus;
export type OvermindChildStatus = "working" | "idle" | "closed";
export type SparkHealthState =
  | "HEALTHY"
  | "IDLE-CLEAN"
  | "CRASHED"
  | "AMBIGUOUS"
  | "ALERT-SOFT"
  | "ALERT-MEDIUM"
  | "ALERT-HARD"
  | "UNKNOWN";

export interface SparkHealth {
  state: SparkHealthState;
  last_classification: string | null;
  minutes_since_ambiguous: number | null;
}

export interface OvermindChildSessionStatus {
  session: string;
  status: OvermindChildStatus;
}

export interface OvermindTask {
  id: string;
  label: string;
  state: OvermindTaskState;
  estimate_min?: number | null;
  actual_min?: number | null;
  started_at?: string | null;
}

export interface OvermindTaskLogEntry {
  at: string;
  current_task: string | null;
  done: number;
  total: number;
  note?: string;
  /** Origin of the task-state change: 'parent' means the parent session called
   *  POST /api/overmind/tasks; 'evidence-derived' means overmind auto-promoted
   *  tasks based on progress.md / callbacks.md / pane evidence (JROM 2026-05-24
   *  lazy-supervisor fix). Default omitted = 'parent'. */
  source?: "parent" | "evidence-derived";
}

export interface OvermindTaskHistoryEntry {
  id: number;
  coordinator_session: string;
  name: string;
  at: string;
  current_task: string | null;
  done: number;
  total: number;
}

export interface RunSummary {
  id: number;
  label: string;
  display_name: string | null;
  coordinator_session: string;
  status: OvermindWorkflowStatus;
  run_started_at: string | null;
  ended_at: string | null;
  /** Most recent parent-initiated API call (F1 field). Null when the parent
   *  has never hit the API since registration — i.e. the History row is fresh. */
  last_parent_update_at: string | null;
  total_tasks: number;
  done_tasks: number;
}

export interface OvermindProject {
  id: number;
  slug: string;
  app_path: string;
  parent_session: string;
  notes: string | null;
  created_by: string;
  latest_parent_status?: OvermindParentStatus | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOvermindProjectInput {
  slug: string;
  app_path: string;
  parent_session: string;
  notes?: string | null;
}

export interface UpdateOvermindProjectInput {
  parent_session?: string;
  notes?: string | null;
}

export interface OvermindWorkflow {
  id: number;
  project_id: number | null;
  label: string;
  display_name: string | null;
  coordinator_session: string;
  child_sessions: string[];
  child_roles: string[];
  run_dir: string;
  status: OvermindWorkflowStatus;
  current_task: string | null;
  tasks: OvermindTask[];
  pending_decision: string | null;
  active_session: string | null;
  active_role: "parent" | "child" | null;
  ended_at: string | null;
  task_log: OvermindTaskLogEntry[];
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
  child_statuses: OvermindChildSessionStatus[];
  info_request: string | null;
  info_check: string | null;
  monitoring_paused: boolean;
  paused_at: string | null;
  paused_by: string | null;
  last_parent_update_at: string | null;
  evidence_idle_threshold_override_minutes: number | null;
  orphaned: boolean;
  /** Persistent counter for the bounded completion-prompt ladder (R3).
   *  Incremented each time OVM sends the proven completion nudge; reset only
   *  when setTasks resyncs the task list (completion_check goes NULL). */
  completion_nudge_count: number;
  spark_health?: SparkHealth;
  created_at: string;
  updated_at: string;
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
  last_notified_transition?: string | null;
  completion_check?: string | null;
  parent_status?: OvermindParentStatus | null;
  child_statuses?: OvermindChildSessionStatus[];
  info_request?: string | null;
  info_check?: string | null;
  orphaned?: boolean;
  completion_nudge_count?: number;
}
