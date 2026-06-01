// SQLite schema constants + fresh-DB extras for AGJAssist. Extracted from
// database.ts in batch B8 of the modularization refactor (2026-05-23). PURE
// DATA: SCHEMA_VERSION + SCHEMA_SQL template + DEFAULT_SAFETY_PATTERNS + the
// fresh-DB extra indexes. Migration *logic* deliberately stays in
// database.ts.ts (see DEC-003) — moving it without a fresh-DB vs upgrade-DB
// parity test is the N1a-incident lesson learned.

import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 28;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'viewer')),
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('bot', 'miniapp', 'web')),
  expires_at TEXT NOT NULL,
  last_activity TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  directory_name TEXT UNIQUE NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tmux_sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  session_name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'terminated')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  terminated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tmux_project ON tmux_sessions(project_id);

CREATE TABLE IF NOT EXISTS tmux_output_history (
  id INTEGER PRIMARY KEY,
  tmux_session_id INTEGER NOT NULL REFERENCES tmux_sessions(id),
  pane_target TEXT NOT NULL,
  content TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tmux_output_session ON tmux_output_history(tmux_session_id);
CREATE INDEX IF NOT EXISTS idx_tmux_output_time ON tmux_output_history(captured_at);

CREATE TABLE IF NOT EXISTS agent_delegations (
  id INTEGER PRIMARY KEY,
  agent_name TEXT NOT NULL,
  tmux_session_id INTEGER NOT NULL REFERENCES tmux_sessions(id),
  pane_target TEXT,
  authority TEXT NOT NULL CHECK(authority IN ('observe', 'suggest', 'execute')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delegations_agent ON agent_delegations(agent_name);
CREATE INDEX IF NOT EXISTS idx_delegations_session ON agent_delegations(tmux_session_id);

CREATE TABLE IF NOT EXISTS note_folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
  tags TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  folder_id INTEGER REFERENCES note_folders(id),
  pinned INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  font_size INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);
-- NOTE: idx_notes_folder / idx_notes_pinned are NOT created here. SCHEMA_SQL runs against
-- existing tables before the v23 ALTER adds folder_id/pinned, so indexing them here crashes
-- an upgrading DB. They are created in the fresh-DB path and the v22→v23 migration block instead.

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);

CREATE TABLE IF NOT EXISTS plan_notes (
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  note_id INTEGER NOT NULL REFERENCES notes(id),
  PRIMARY KEY (plan_id, note_id)
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  step_order INTEGER NOT NULL,
  description TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_steps_plan ON plan_steps(plan_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  plan_step_id INTEGER REFERENCES plan_steps(id),
  title TEXT NOT NULL,
  description TEXT,
  acceptance_criteria TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'blocked')),
  assigned_to TEXT,
  tmux_session_id INTEGER REFERENCES tmux_sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_executions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  executor TEXT NOT NULL,
  tmux_session_id INTEGER REFERENCES tmux_sessions(id),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  output_summary TEXT,
  error_details TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_executions_task ON task_executions(task_id);

CREATE TABLE IF NOT EXISTS safety_patterns (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,
  description TEXT,
  is_regex INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id),
  agent_name TEXT,
  action_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  tmux_target TEXT,
  surface TEXT CHECK(surface IN ('bot', 'miniapp', 'web', 'agent'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_name);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(action_type);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  agent_name TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  messages TEXT NOT NULL DEFAULT '[]',
  cli_session_id TEXT,
  cwd TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_name);

CREATE TABLE IF NOT EXISTS step_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS step_template_items (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES step_templates(id) ON DELETE CASCADE,
  item_order INTEGER NOT NULL,
  description TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_template_items_template ON step_template_items(template_id);

CREATE TABLE IF NOT EXISTS personal_tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL CHECK(frequency IN ('once', 'daily', 'weekly')),
  day_of_week INTEGER,
  due_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  template_id INTEGER REFERENCES personal_tasks(id),
  target_date TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pt_template ON personal_tasks(template_id);
CREATE INDEX IF NOT EXISTS idx_pt_target_date ON personal_tasks(target_date);

CREATE TABLE IF NOT EXISTS personal_task_completions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  completed_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(task_id, completed_date)
);
CREATE INDEX IF NOT EXISTS idx_ptc_task ON personal_task_completions(task_id);
CREATE INDEX IF NOT EXISTS idx_ptc_date ON personal_task_completions(completed_date);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,
  reminder_1 TEXT,
  reminder_2 TEXT,
  sent_1 INTEGER NOT NULL DEFAULT 0,
  sent_2 INTEGER NOT NULL DEFAULT 0,
  sent_event INTEGER NOT NULL DEFAULT 0,
  recurrence TEXT,
  next_event_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_settings (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS personal_task_items (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pti_task ON personal_task_items(task_id);

CREATE TABLE IF NOT EXISTS reminder_alerts (
  id INTEGER PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  offset_value INTEGER NOT NULL,
  offset_unit TEXT NOT NULL CHECK(offset_unit IN ('hours', 'days')),
  sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ra_reminder ON reminder_alerts(reminder_id);

CREATE TABLE IF NOT EXISTS overmind_projects (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  app_path TEXT UNIQUE NOT NULL,
  parent_session TEXT NOT NULL,
  notes TEXT,
  created_by TEXT NOT NULL DEFAULT 'JROM',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_overmind_projects_app_path ON overmind_projects(app_path);

CREATE TABLE IF NOT EXISTS overmind_workflows (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES overmind_projects(id),
  label TEXT,
  display_name TEXT,
  coordinator_session TEXT,
  child_sessions TEXT NOT NULL DEFAULT '[]',
  child_roles TEXT NOT NULL DEFAULT '[]',
  run_dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'working', 'waiting_human', 'awaiting_decision', 'stuck', 'paused', 'completed', 'failed')),
  current_task TEXT,
  tasks TEXT NOT NULL DEFAULT '[]',
  pending_decision TEXT,
  active_session TEXT,
  active_role TEXT CHECK(active_role IN ('parent', 'child') OR active_role IS NULL),
  ended_at TEXT,
  task_log TEXT NOT NULL DEFAULT '[]',
  last_pane_hash TEXT,
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  stuck_since TEXT,
  nudge_count INTEGER NOT NULL DEFAULT 0,
  tier INTEGER NOT NULL DEFAULT 0,
  last_notified_transition TEXT,
  run_started_at TEXT,
  accumulated_ms INTEGER NOT NULL DEFAULT 0,
  completion_check TEXT,
  parent_status TEXT,
  child_statuses TEXT NOT NULL DEFAULT '[]',
  info_request TEXT,
  info_check TEXT,
  monitoring_paused INTEGER NOT NULL DEFAULT 0,
  paused_at TEXT,
  paused_by TEXT,
  last_parent_update_at TEXT,
  evidence_idle_threshold_override_minutes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_overmind_workflows_coordinator_session ON overmind_workflows(coordinator_session);
CREATE INDEX IF NOT EXISTS idx_overmind_workflows_status ON overmind_workflows(status);

CREATE TABLE IF NOT EXISTS overmind_task_history (
  id INTEGER PRIMARY KEY,
  coordinator_session TEXT NOT NULL,
  name TEXT NOT NULL,
  at TEXT NOT NULL,
  current_task TEXT,
  done INTEGER NOT NULL,
  total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overmind_task_history_coordinator_session ON overmind_task_history(coordinator_session);
`;

export const DEFAULT_SAFETY_PATTERNS = [
  { pattern: "rm -rf", description: "Recursive force delete", is_regex: 0 },
  { pattern: "rm -r", description: "Recursive delete", is_regex: 0 },
  { pattern: "drop table", description: "Database table deletion", is_regex: 0 },
  { pattern: "drop database", description: "Database deletion", is_regex: 0 },
  { pattern: "kill -9", description: "Force kill process", is_regex: 0 },
  { pattern: "reboot", description: "System reboot", is_regex: 0 },
  { pattern: "shutdown", description: "System shutdown", is_regex: 0 },
  { pattern: "mkfs", description: "Filesystem format", is_regex: 0 },
  { pattern: "dd if=", description: "Disk write", is_regex: 0 },
  { pattern: "chmod 777", description: "Overly permissive permissions", is_regex: 0 },
  { pattern: "> /dev/", description: "Device writes", is_regex: 0 }
];

/**
 * Indexes that depend on columns added via ALTER on the upgrade path. Kept
 * outside SCHEMA_SQL because running them inside the template would fail on
 * existing DBs before the relevant migration block adds the column. Called by
 * the fresh-DB code path in DatabaseService.initSchema(); the upgrade path
 * creates these inside the corresponding migration block.
 */
export function applyFreshDbExtras(db: Database.Database): void {
  db.exec("CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_id ON overmind_workflows(project_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_status ON overmind_workflows(project_id, status)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_overmind_workflows_project_run_dir ON overmind_workflows(project_id, run_dir)");
}
