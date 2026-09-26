// SQLite schema constants + fresh-DB extras for AGJAssist. Extracted from
// database.ts in batch B8 of the modularization refactor (2026-05-23). PURE
// DATA: SCHEMA_VERSION + SCHEMA_SQL template + DEFAULT_SAFETY_PATTERNS + the
// fresh-DB extra indexes. Migration *logic* deliberately stays in
// database.ts.ts (see DEC-003) — moving it without a fresh-DB vs upgrade-DB
// parity test is the N1a-incident lesson learned.

import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 40;

export const XM_ACTION_STATE_SQL = `
CREATE TABLE IF NOT EXISTS xm_action_state (
  id INTEGER PRIMARY KEY,
  machine_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('on','off')),
  status TEXT NOT NULL CHECK(status IN ('in-progress','rejected','completed','failed')),
  idempotency_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  owner_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  gateway_exit_status INTEGER,
  final_state TEXT,
  reject_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_xm_action_state_idempotency ON xm_action_state(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_xm_action_state_request ON xm_action_state(request_id);
CREATE INDEX IF NOT EXISTS idx_xm_action_state_machine ON xm_action_state(machine_name, started_at);
`;

// Reader failure rows. L5j reads this table back after a timed-out probe.
export const XM_READER_RESULTS_SQL = `
CREATE TABLE IF NOT EXISTS xm_reader_results (
  id INTEGER PRIMARY KEY,
  machine_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('smart','nut')),
  availability TEXT NOT NULL CHECK(availability IN ('ok','unavailable')),
  freshness TEXT NOT NULL CHECK(freshness IN ('fresh','stale')),
  value TEXT,
  sample_time TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xm_reader_results_machine_time ON xm_reader_results(machine_name, sample_time);
`;

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

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex', 'grok')),
  model TEXT NOT NULL,
  default_effort TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_bindings (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('projcore', 'coord', 'implementer', 'validator', 'deliberation_1', 'deliberation_2', 'deliberation_3', 'redteam_1', 'redteam_2', 'redteam_3')),
  agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, role)
);

CREATE TABLE IF NOT EXISTS role_defaults (
  role TEXT PRIMARY KEY CHECK(role IN ('projcore', 'coord', 'implementer', 'validator', 'deliberation_1', 'deliberation_2', 'deliberation_3', 'redteam_1', 'redteam_2', 'redteam_3')),
  agent_id INTEGER NOT NULL REFERENCES agents(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  surface TEXT CHECK(surface IN ('bot', 'miniapp', 'web', 'agent', 'mcp'))
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

CREATE TABLE IF NOT EXISTS agent_events (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  session TEXT,
  type TEXT NOT NULL CHECK(type IN ('message', 'status', 'tool', 'gate')),
  state TEXT,
  source TEXT NOT NULL CHECK(source IN ('callback', 'git', 'pane', 'post')),
  correlation_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '{}',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_events_run_ts ON agent_events(run_id, ts);
CREATE INDEX IF NOT EXISTS idx_agent_events_batch_type ON agent_events(run_id, batch_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_terminal_dedupe
  ON agent_events(run_id, batch_id, state, correlation_id)
  WHERE type = 'status' AND state IN ('DONE', 'BLOCKED');

CREATE TABLE IF NOT EXISTS agent_wake_schedule (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  target_session TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('poke-pane', 'wake-coordinator')),
  due_at TEXT NOT NULL,
  fired_at TEXT,
  outcome TEXT,
  body TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_agent_wake_schedule_due
  ON agent_wake_schedule(due_at, fired_at);
CREATE INDEX IF NOT EXISTS idx_agent_wake_schedule_run
  ON agent_wake_schedule(run_id, batch_id);

CREATE TABLE IF NOT EXISTS terminal_groups (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{"groups":[],"activeGroup":"all"}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_clients (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL CHECK(length(client_name) BETWEEN 1 AND 80),
  redirect_uris TEXT NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none' CHECK(token_endpoint_auth_method='none'),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS mcp_grantable_pool (
  session_name TEXT PRIMARY KEY
    CHECK(length(session_name) BETWEEN 1 AND 128 AND session_name NOT GLOB '*[^A-Za-z0-9_.-]*'),
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS mcp_grants (
  id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('sessions','group')),
  scope_ref TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  lifetime INTEGER NOT NULL DEFAULT 0 CHECK(lifetime IN (0,1)),
  token_ttl_days INTEGER NOT NULL DEFAULT 7 CHECK(token_ttl_days BETWEEN 7 AND 10),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_grants_client ON mcp_grants(client_id);
CREATE INDEX IF NOT EXISTS idx_mcp_grants_owner_status ON mcp_grants(granted_by, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_grants_one_active ON mcp_grants(client_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  grant_id INTEGER NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  token_type TEXT NOT NULL CHECK(token_type IN ('access','refresh')),
  family_id TEXT NOT NULL,
  rotated_from TEXT REFERENCES mcp_tokens(id),
  audience TEXT NOT NULL,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  revoked_at TEXT,
  rotated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_grant ON mcp_tokens(grant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_client_type ON mcp_tokens(client_id, token_type);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_family ON mcp_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_expiry ON mcp_tokens(expires_at);

CREATE TABLE IF NOT EXISTS mcp_authorization_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash)=64),
  grant_id INTEGER NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  audience TEXT NOT NULL,
  family_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_codes_grant ON mcp_authorization_codes(grant_id);
CREATE INDEX IF NOT EXISTS idx_mcp_codes_expiry ON mcp_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS agent_solicit_reminders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  folder_group TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL CHECK(cadence_minutes > 0),
  repeat_limit INTEGER,
  repeat_count INTEGER NOT NULL DEFAULT 0,
  next_fire TEXT,
  solicit_message TEXT NOT NULL DEFAULT 'give me a status update',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_solicit_reminders_user_folder ON agent_solicit_reminders(user_id, folder_group);
CREATE INDEX IF NOT EXISTS idx_agent_solicit_reminders_next_fire ON agent_solicit_reminders(next_fire);

CREATE TABLE IF NOT EXISTS agent_solicit_recipients (
  id INTEGER PRIMARY KEY,
  reminder_id INTEGER NOT NULL REFERENCES agent_solicit_reminders(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  include INTEGER NOT NULL DEFAULT 1 CHECK(include IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_solicit_recipients_reminder ON agent_solicit_recipients(reminder_id);
CREATE INDEX IF NOT EXISTS idx_agent_solicit_recipients_agent ON agent_solicit_recipients(agent_name);

CREATE TABLE IF NOT EXISTS summary_llm_endpoints (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  provenance TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO summary_llm_endpoints (name, base_url, model, is_default, provenance) VALUES ('140', 'http://192.168.254.140:1234/v1', 'qwen2.5-14b-instruct', 1, 'system');
CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_llm_endpoints_one_default ON summary_llm_endpoints(is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS agent_summaries (
  id INTEGER PRIMARY KEY,
  agent_name TEXT NOT NULL,
  endpoint_id INTEGER NOT NULL REFERENCES summary_llm_endpoints(id),
  summary_text TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_agent ON agent_summaries(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_endpoint ON agent_summaries(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_agent_summaries_created ON agent_summaries(created_at);

CREATE TABLE IF NOT EXISTS agent_one_time_wakeups (
  id INTEGER PRIMARY KEY,
  pane_target TEXT NOT NULL,
  manual_fire_time TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','fired','cancelled')) DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_one_time_wakeups_status ON agent_one_time_wakeups(status);
CREATE INDEX IF NOT EXISTS idx_agent_one_time_wakeups_fire_time ON agent_one_time_wakeups(manual_fire_time);

CREATE TABLE IF NOT EXISTS xm_samples (
  id INTEGER PRIMARY KEY,
  machine_name TEXT NOT NULL,
  gpu_uuid TEXT NOT NULL,
  sample_time TEXT NOT NULL DEFAULT (datetime('now')),
  temperature REAL,
  power_watts REAL,
  utilization_gpu REAL,
  utilization_mem REAL,
  fan_speed REAL,
  vram_mb REAL,
  vram_total_mb REAL
);
CREATE INDEX IF NOT EXISTS idx_xm_samples_machine_time ON xm_samples(machine_name, sample_time);
CREATE INDEX IF NOT EXISTS idx_xm_samples_gpu_uuid ON xm_samples(gpu_uuid);

CREATE TABLE IF NOT EXISTS xm_devices (
  id INTEGER PRIMARY KEY,
  machine_name TEXT NOT NULL,
  gpu_uuid TEXT NOT NULL UNIQUE,
  gpu_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  ordinal INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xm_devices_machine ON xm_devices(machine_name);

CREATE TABLE IF NOT EXISTS xm_alerts (
  id INTEGER PRIMARY KEY,
  machine_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  alert_level TEXT NOT NULL CHECK(alert_level IN ('warning','critical')),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dedupe_key TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_xm_alerts_machine_time ON xm_alerts(machine_name, created_at);
CREATE INDEX IF NOT EXISTS idx_xm_alerts_dedupe ON xm_alerts(dedupe_key);

CREATE TABLE IF NOT EXISTS xm_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
${XM_ACTION_STATE_SQL}
${XM_READER_RESULTS_SQL}`;

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
}

/** Additive objects that must exist even on a DB already stamped at version 40. */
export function applyXmachinesAdditiveFixes(db: Database.Database): void {
  db.exec(XM_ACTION_STATE_SQL);
  db.exec(XM_READER_RESULTS_SQL);
  const devices = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xm_devices'")
    .get() as { name: string } | undefined;
  if (devices) {
    const cols = db.pragma("table_info(xm_devices)") as { name: string }[];
    if (!cols.some((col) => col.name === "ordinal")) {
      db.exec("ALTER TABLE xm_devices ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0");
    }
  }
  const samples = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xm_samples'")
    .get() as { name: string } | undefined;
  if (!samples) return;
  const sampleCols = db.pragma("table_info(xm_samples)") as { name: string }[];
  if (!sampleCols.some((col) => col.name === "vram_total_mb")) {
    db.exec("ALTER TABLE xm_samples ADD COLUMN vram_total_mb REAL");
  }
}
