import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const SCHEMA_VERSION = 11;

const SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
  tags TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);

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

CREATE TABLE IF NOT EXISTS overmind_workflows (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  coordinator_session TEXT NOT NULL UNIQUE,
  child_sessions TEXT NOT NULL DEFAULT '[]',
  run_dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'working', 'waiting_human', 'awaiting_decision', 'stuck', 'paused', 'completed', 'failed')),
  current_task TEXT,
  tasks TEXT NOT NULL DEFAULT '[]',
  pending_decision TEXT,
  last_pane_hash TEXT,
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  stuck_since TEXT,
  nudge_count INTEGER NOT NULL DEFAULT 0,
  tier INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_overmind_workflows_coordinator_session ON overmind_workflows(coordinator_session);
CREATE INDEX IF NOT EXISTS idx_overmind_workflows_status ON overmind_workflows(status);
`;

const DEFAULT_SAFETY_PATTERNS = [
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

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    const versionRow = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
      .get() as { name: string } | undefined;

    if (!versionRow) {
      this.db.exec(SCHEMA_SQL);
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
      this.seedSafetyPatterns();
      return;
    }

    const current = this.db.prepare("SELECT version FROM schema_version").get() as
      | { version: number }
      | undefined;

    if (!current || current.version < SCHEMA_VERSION) {
      // Migration: v1 → v2: add totp columns to users
      if (current && current.version < 2) {
        const cols = this.db.pragma("table_info(users)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("totp_secret")) {
          this.db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
        }
        if (!colNames.has("totp_enabled")) {
          this.db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
        }
      }

      // Migration: v2 → v3: add step_templates and step_template_items tables
      // Tables are created via SCHEMA_SQL below (CREATE IF NOT EXISTS)

      // Migration: v3 → v4: add personal_tasks, personal_task_completions, reminders, chat_settings tables
      // Tables are created via SCHEMA_SQL below (CREATE IF NOT EXISTS)

      // Migration: v4 → v5: add personal_task_items, reminder_alerts tables; add recurrence/next_event_date to reminders
      if (current && current.version < 5) {
        const reminderCols = this.db.pragma("table_info(reminders)") as { name: string }[];
        const reminderColNames = new Set(reminderCols.map((c) => c.name));
        if (!reminderColNames.has("recurrence")) {
          this.db.exec("ALTER TABLE reminders ADD COLUMN recurrence TEXT");
        }
        if (!reminderColNames.has("next_event_date")) {
          this.db.exec("ALTER TABLE reminders ADD COLUMN next_event_date TEXT");
        }
        // Migrate existing reminder_1/reminder_2 data to reminder_alerts after SCHEMA_SQL creates the table
      }

      // Migration: v5 → v6: add projects.active, bitmask day_of_week, personal_tasks.completed_at
      if (current && current.version < 6) {
        const projCols = this.db.pragma("table_info(projects)") as { name: string }[];
        if (!projCols.some(c => c.name === "active")) {
          this.db.exec("ALTER TABLE projects ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
        }

        // Migrate day_of_week from single-day (0-6) to bitmask
        const dayToBitmask = [1, 2, 4, 8, 16, 32, 64]; // Sun=1, Mon=2, ..., Sat=64
        const dailyTasks = this.db.prepare(
          "SELECT id, day_of_week FROM personal_tasks WHERE frequency = 'daily' AND day_of_week IS NOT NULL AND day_of_week <= 6"
        ).all() as { id: number; day_of_week: number }[];

        for (const task of dailyTasks) {
          const bitmask = dayToBitmask[task.day_of_week];
          this.db.prepare("UPDATE personal_tasks SET day_of_week = ? WHERE id = ?").run(bitmask, task.id);
        }

        // Set NULL day_of_week to 127 (all days) for daily tasks
        this.db.prepare(
          "UPDATE personal_tasks SET day_of_week = 127 WHERE frequency = 'daily' AND day_of_week IS NULL"
        ).run();

        // Add completed_at column
        const ptCols = this.db.pragma("table_info(personal_tasks)") as { name: string }[];
        if (!ptCols.some(c => c.name === "completed_at")) {
          this.db.exec("ALTER TABLE personal_tasks ADD COLUMN completed_at TEXT");
        }
      }

      // Migration: v6 → v7: add cli_session_id to conversations
      if (current && current.version < 7) {
        const convCols = this.db.pragma("table_info(conversations)") as { name: string }[];
        const convColNames = new Set(convCols.map(c => c.name));
        if (!convColNames.has("cli_session_id")) {
          this.db.exec("ALTER TABLE conversations ADD COLUMN cli_session_id TEXT");
        }
      }

      // Migration: v7 → v8: add template_id and target_date to personal_tasks
      if (current && current.version < 8) {
        const ptCols = this.db.pragma("table_info(personal_tasks)") as { name: string }[];
        const ptColNames = new Set(ptCols.map(c => c.name));
        if (!ptColNames.has("template_id")) {
          this.db.exec("ALTER TABLE personal_tasks ADD COLUMN template_id INTEGER REFERENCES personal_tasks(id)");
        }
        if (!ptColNames.has("target_date")) {
          this.db.exec("ALTER TABLE personal_tasks ADD COLUMN target_date TEXT");
        }
      }

      this.db.exec(SCHEMA_SQL);

      // After tables exist, migrate reminder_1/reminder_2 to reminder_alerts
      if (current && current.version < 5) {
        const reminders = this.db.prepare(
          "SELECT id, event_date, reminder_1, reminder_2 FROM reminders WHERE reminder_1 IS NOT NULL OR reminder_2 IS NOT NULL"
        ).all() as { id: number; event_date: string; reminder_1: string | null; reminder_2: string | null }[];

        const insertAlert = this.db.prepare(
          "INSERT OR IGNORE INTO reminder_alerts (reminder_id, offset_value, offset_unit, sent) VALUES (?, ?, ?, 0)"
        );

        for (const r of reminders) {
          // Check if alerts already exist for this reminder
          const existing = this.db.prepare("SELECT COUNT(*) as cnt FROM reminder_alerts WHERE reminder_id = ?").get(r.id) as { cnt: number };
          if (existing.cnt > 0) continue;

          const eventTime = new Date(r.event_date).getTime();
          if (r.reminder_1) {
            const r1Time = new Date(r.reminder_1).getTime();
            const diffHours = Math.max(1, Math.round((eventTime - r1Time) / (1000 * 60 * 60)));
            if (diffHours >= 24 && diffHours % 24 === 0) {
              insertAlert.run(r.id, diffHours / 24, "days");
            } else {
              insertAlert.run(r.id, diffHours, "hours");
            }
          }
          if (r.reminder_2) {
            const r2Time = new Date(r.reminder_2).getTime();
            const diffHours = Math.max(1, Math.round((eventTime - r2Time) / (1000 * 60 * 60)));
            if (diffHours >= 24 && diffHours % 24 === 0) {
              insertAlert.run(r.id, diffHours / 24, "days");
            } else {
              insertAlert.run(r.id, diffHours, "hours");
            }
          }
        }
      }

      // Migration: v8 → v9: add cwd to conversations
      if (current && current.version < 9) {
        const convCols = this.db.pragma("table_info(conversations)") as { name: string }[];
        if (!convCols.some(c => c.name === "cwd")) {
          this.db.exec("ALTER TABLE conversations ADD COLUMN cwd TEXT");
        }
      }

      // Migration: v9 → v10: make notes.project_id nullable (recreate table)
      if (current && current.version < 10) {
        // Check if notes table has NOT NULL on project_id by trying an insert
        // Safer approach: recreate table without NOT NULL constraint
        this.db.exec("PRAGMA foreign_keys = OFF");
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS notes_new (
            id INTEGER PRIMARY KEY,
            project_id INTEGER REFERENCES projects(id),
            title TEXT,
            body TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
            tags TEXT,
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT OR IGNORE INTO notes_new SELECT * FROM notes;
          DROP TABLE IF EXISTS notes;
          ALTER TABLE notes_new RENAME TO notes;
          CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
          CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);
          CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);
        `);
        this.db.exec("PRAGMA foreign_keys = ON");
      }

      // Migration: v10 → v11: add overmind_workflows table
      if (current && current.version < 11) {
        this.db.exec(SCHEMA_SQL);
      }

      this.db
        .prepare("UPDATE schema_version SET version = ?")
        .run(SCHEMA_VERSION);
    }
  }

  private seedSafetyPatterns(): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO safety_patterns (pattern, description, is_regex) VALUES (?, ?, ?)"
    );
    const tx = this.db.transaction(() => {
      for (const p of DEFAULT_SAFETY_PATTERNS) {
        insert.run(p.pattern, p.description, p.is_regex);
      }
    });
    tx();
  }

  ensureOwner(telegramId: number): void {
    const existing = this.db
      .prepare("SELECT id FROM users WHERE telegram_id = ?")
      .get(telegramId) as { id: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          "INSERT INTO users (telegram_id, role, active) VALUES (?, 'owner', 1)"
        )
        .run(telegramId);
    } else {
      this.db
        .prepare("UPDATE users SET role = 'owner', active = 1 WHERE telegram_id = ?")
        .run(telegramId);
    }
  }

  get raw(): Database.Database {
    return this.db;
  }

  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
