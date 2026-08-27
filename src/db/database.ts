import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { SCHEMA_VERSION, SCHEMA_SQL, DEFAULT_SAFETY_PATTERNS, applyFreshDbExtras } from "./schema.js";

// Schema-data constants live in ./schema.ts (B8 / DEC-003). Migration logic
// stays here — see DEC-003 for the strict-safety rationale.


export class DatabaseService {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
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
      // Fresh-DB-only DDL (new-column indexes that can't live inside SCHEMA_SQL —
      // they reference columns the v23 ALTER adds on the upgrade path). See
      // applyFreshDbExtras + DEC-003.
      applyFreshDbExtras(this.db);
      this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
      this.seedSafetyPatterns();
      this.seedDefaultNotesFolder();
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

      // Migration: v11 → v12: add active-session attribution to overmind_workflows
      if (current && current.version < 12 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("active_session")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN active_session TEXT");
        }
        if (!colNames.has("active_role")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN active_role TEXT CHECK(active_role IN ('parent', 'child') OR active_role IS NULL)");
        }
      }

      // Migration: v12 → v13: add workflow completion timestamp and task history log
      if (current && current.version < 13 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("ended_at")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN ended_at TEXT");
        }
        if (!colNames.has("task_log")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN task_log TEXT NOT NULL DEFAULT '[]'");
        }
      }

      // Migration: v13 → v14: persist once-per-transition overmind notifications
      if (current && current.version < 14 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("last_notified_transition")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN last_notified_transition TEXT");
        }
      }

      // Migration: v14 → v15: track current overmind run start and accumulated elapsed time
      if (current && current.version < 15 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("run_started_at")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN run_started_at TEXT");
        }
        if (!colNames.has("accumulated_ms")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN accumulated_ms INTEGER NOT NULL DEFAULT 0");
        }
        this.db.exec("UPDATE overmind_workflows SET run_started_at = created_at WHERE run_started_at IS NULL");
      }

      // Migration: v15 → v16: add user-controlled overmind workflow display name
      if (current && current.version < 16 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("display_name")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN display_name TEXT");
        }
      }

      // Migration: v16 → v17: add persistent overmind task history archive
      if (current && current.version < 17) {
        this.db.exec(SCHEMA_SQL);
      }

      // Migration: v17 → v18: gate Sonnet completion-edge check once per all-done state
      if (current && current.version < 18 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("completion_check")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN completion_check TEXT");
        }
      }

      // Migration: v18 → v19: persist independent parent/child session statuses
      if (current && current.version < 19 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("parent_status")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN parent_status TEXT");
        }
        if (!colNames.has("child_statuses")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN child_statuses TEXT NOT NULL DEFAULT '[]'");
        }
      }

      // Migration: v19 → v20: per-child role labels (e.g. coder/tester) for multi-agent workflows
      if (current && current.version < 20 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("child_roles")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN child_roles TEXT NOT NULL DEFAULT '[]'");
        }
      }

      // Migration: v20 → v21: registration completeness badge (info_request) + dedupe signature (info_check)
      if (current && current.version < 21 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("info_request")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN info_request TEXT");
        }
        if (!colNames.has("info_check")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN info_check TEXT");
        }
      }

      // Migration: v21 → v22: JROM-initiated monitoring pause (suppresses all interrupts
      // while he talks to a coordinator) — flag is separate from status so the card stays visible.
      if (current && current.version < 22 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("monitoring_paused")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN monitoring_paused INTEGER NOT NULL DEFAULT 0");
        }
        if (!colNames.has("paused_at")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN paused_at TEXT");
        }
        if (!colNames.has("paused_by")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN paused_by TEXT");
        }
      }

      // Migration: v22 → v23: iPhone Notes model — note_folders table + folder_id/pinned/position
      // columns on notes. Data-safe: seeds default "Notes" folder (owner user) and assigns all
      // existing notes (folder_id IS NULL) to that folder. project_id/status/tags left dormant.
      if (current && current.version < 23) {
        // Create note_folders table if it doesn't exist yet
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS note_folders (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);

        // Add new columns to notes (guarded PRAGMA table_info pattern)
        const noteCols = this.db.pragma("table_info(notes)") as { name: string }[];
        const noteColNames = new Set(noteCols.map((c) => c.name));
        if (!noteColNames.has("folder_id")) {
          this.db.exec("ALTER TABLE notes ADD COLUMN folder_id INTEGER REFERENCES note_folders(id)");
        }
        if (!noteColNames.has("pinned")) {
          this.db.exec("ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
        }
        if (!noteColNames.has("position")) {
          this.db.exec("ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
        }

        // Indexes
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id)");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned)");

        // Seed default "Notes" folder (idempotent helper handles exists-check)
        this.seedDefaultNotesFolder();

        // Assign all existing notes with no folder to the default folder
        const defaultFolder = this.db.prepare(
          "SELECT id FROM note_folders WHERE name = 'Notes' LIMIT 1"
        ).get() as { id: number } | undefined;
        if (defaultFolder) {
          this.db.prepare(
            "UPDATE notes SET folder_id = ? WHERE folder_id IS NULL"
          ).run(defaultFolder.id);
        }
      }

      // Migration: v23 → v24: parent update timestamp + per-workflow ask-update cooldown override
      if (current && current.version < 24 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("last_parent_update_at")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN last_parent_update_at TEXT");
        }
        if (!colNames.has("ask_update_cooldown_override_minutes")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN ask_update_cooldown_override_minutes INTEGER");
        }
      }

      // Migration: v24 → v25 (JROM 2026-05-24): rename the per-workflow idle
      // cooldown override column. SQLite < 3.25 had no RENAME COLUMN; we use
      // the canonical ADD-COPY-leave-old pattern so older runtimes can apply
      // the migration safely and downstream code can read from either column
      // during a deploy window. The OLD column is left in place (NOT dropped)
      // — preserves rollback safety + avoids a table rebuild.
      if (current && current.version < 25 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("evidence_idle_threshold_override_minutes")) {
          this.db.exec(
            "ALTER TABLE overmind_workflows ADD COLUMN evidence_idle_threshold_override_minutes INTEGER"
          );
        }
        if (colNames.has("ask_update_cooldown_override_minutes")) {
          this.db.exec(
            `UPDATE overmind_workflows
             SET evidence_idle_threshold_override_minutes = ask_update_cooldown_override_minutes
             WHERE ask_update_cooldown_override_minutes IS NOT NULL
               AND evidence_idle_threshold_override_minutes IS NULL`
          );
        }
      }

      // Migration: v25 → v26: add font_size column to notes for per-note font size picker
      if (current && current.version < 26) {
        const noteCols = this.db.pragma("table_info(notes)") as { name: string }[];
        const noteColNames = new Set(noteCols.map((c) => c.name));
        if (!noteColNames.has("font_size")) {
          this.db.exec("ALTER TABLE notes ADD COLUMN font_size INTEGER NOT NULL DEFAULT 15");
        }
      }

      // Migration: v26 → v27: project source-of-truth table and nullable workflow FK
      if (current && current.version < 27 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS overmind_projects (
            id INTEGER PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            app_path TEXT UNIQUE NOT NULL,
            parent_session TEXT NOT NULL,
            notes TEXT,
            created_by TEXT NOT NULL DEFAULT 'JROM',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);

        const workflowCols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const workflowColNames = new Set(workflowCols.map((c) => c.name));
        if (!workflowColNames.has("project_id")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN project_id INTEGER REFERENCES overmind_projects(id)");
        }

        this.db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_projects_app_path ON overmind_projects(app_path)");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_id ON overmind_workflows(project_id)");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_status ON overmind_workflows(project_id, status)");
      }

      // Migration: v27 → v28: workflow identity no longer depends on session.
      // SQLite cannot relax NOT NULL/drop UNIQUE in place, so rebuild with an
      // explicit column copy. Only label/coordinator_session constraints change.
      if (current && current.version < 28 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const workflowColumns = [
          "id",
          "project_id",
          "label",
          "display_name",
          "coordinator_session",
          "child_sessions",
          "child_roles",
          "run_dir",
          "status",
          "current_task",
          "tasks",
          "pending_decision",
          "active_session",
          "active_role",
          "ended_at",
          "task_log",
          "last_pane_hash",
          "last_activity_at",
          "stuck_since",
          "nudge_count",
          "tier",
          "last_notified_transition",
          "run_started_at",
          "accumulated_ms",
          "completion_check",
          "parent_status",
          "child_statuses",
          "info_request",
          "info_check",
          "monitoring_paused",
          "paused_at",
          "paused_by",
          "last_parent_update_at",
          "evidence_idle_threshold_override_minutes",
          "created_at",
          "updated_at"
        ];
        const columnList = workflowColumns.join(", ");
        const before = this.db
          .prepare("SELECT COUNT(*) AS count FROM overmind_workflows")
          .get() as { count: number };

        this.db.exec("PRAGMA foreign_keys = OFF");
        try {
          const rebuild = this.db.transaction(() => {
            this.db.exec(`
              CREATE TABLE overmind_workflows_new (
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
              INSERT INTO overmind_workflows_new (${columnList})
              SELECT ${columnList}
              FROM overmind_workflows;
            `);

            const copied = this.db
              .prepare("SELECT COUNT(*) AS count FROM overmind_workflows_new")
              .get() as { count: number };
            if (copied.count !== before.count) {
              throw new Error(`overmind_workflows v28 rebuild copied ${copied.count} rows, expected ${before.count}`);
            }

            this.db.exec(`
              DROP TABLE overmind_workflows;
              ALTER TABLE overmind_workflows_new RENAME TO overmind_workflows;
              CREATE INDEX IF NOT EXISTS idx_overmind_workflows_coordinator_session ON overmind_workflows(coordinator_session);
              CREATE INDEX IF NOT EXISTS idx_overmind_workflows_status ON overmind_workflows(status);
              CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_id ON overmind_workflows(project_id);
              CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_status ON overmind_workflows(project_id, status);
              CREATE UNIQUE INDEX IF NOT EXISTS idx_overmind_workflows_project_run_dir ON overmind_workflows(project_id, run_dir);
            `);

            const fkProblems = this.db.pragma("foreign_key_check") as unknown[];
            if (fkProblems.length > 0) {
              throw new Error(`overmind_workflows v28 rebuild foreign_key_check failed with ${fkProblems.length} violation(s)`);
            }
          });
          rebuild();
        } finally {
          this.db.exec("PRAGMA foreign_keys = ON");
        }
      }

      // Migration: v28 → v29: mark OVM runs whose parent coordinator and child
      // sessions are all gone. Kept as a flag so the future ERROR tab can own
      // display without changing the owner's completion path.
      if (current && current.version < 29 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("orphaned")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN orphaned INTEGER NOT NULL DEFAULT 0");
        }
      }

      // Migration: v29 → v30: persistent counter for the bounded completion-prompt
      // ladder (R3). Separate from nudge_count (which is the generic stuck/idle
      // ladder) so the two paths don't interfere and the counter survives across
      // ticks without being reset by unrelated code.
      if (current && current.version < 30 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("completion_nudge_count")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN completion_nudge_count INTEGER NOT NULL DEFAULT 0");
        }
      }

      // Migration: v30 → v31: monotonic completion-prompt redesign (iter2 red-team plugs).
      // Adds working_accepts (separate consecutive-working counter) and
      // completion_nudge_last_at (persisted cooldown anchor so restarts don't spam).
      // Cleans up the old sign-convention hack where completion_nudge_count < 0 was
      // used as a working-accepts counter — reset any negative values to 0 on upgrade.
      if (current && current.version < 31 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
        const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
        const colNames = new Set(cols.map((c) => c.name));
        if (!colNames.has("working_accepts")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN working_accepts INTEGER NOT NULL DEFAULT 0");
        }
        if (!colNames.has("completion_nudge_last_at")) {
          this.db.exec("ALTER TABLE overmind_workflows ADD COLUMN completion_nudge_last_at TEXT");
        }
        // Heal any negative completion_nudge_count values from the old sign hack.
        this.db.exec("UPDATE overmind_workflows SET completion_nudge_count = 0 WHERE completion_nudge_count < 0");
      }

      // Migration: v31 → v32: reusable Agent definitions and per-project role bindings.
      if (current && current.version < 32) {
        this.db.exec(`
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
        `);
      }

      // Migration: v32 → v33: unified structured agent event stream.
      if (current && current.version < 33) {
        this.db.exec(`
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
        `);
      }

      // Migration: v33 → v34: app-owned wake schedule for provider-agnostic callbacks.
      if (current && current.version < 34) {
        this.db.exec(`
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
        `);
      }

      // Migration: v34 → v35 (repo) / through v38 (prod) → v39: per-user terminal
      // session groups (account-level folders). Prod DBs already sit at 38 from
      // out-of-tree upgrades, so the create is gated on < 39 and is IF NOT EXISTS.
      if (current && current.version < 35) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS terminal_groups (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            data TEXT NOT NULL DEFAULT '{"groups":[],"activeGroup":"all"}',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
      }

      // Migration: v35 → v36: MCP OAuth/grant persistence and dedicated audit surface.
      // The table DDL mirrors the fresh schema. audit_log requires a rebuild because
      // SQLite cannot widen a CHECK constraint in place.
      if (current && current.version < 36) {
        const auditDefinition = this.db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
          .get() as { sql: string | null } | undefined;
        const auditAlreadySupportsMcp = Boolean(
          auditDefinition?.sql &&
          /surface\s+TEXT\s+CHECK\s*\(\s*surface\s+IN\s*\([^)]*'mcp'/i.test(auditDefinition.sql)
        );

        this.db.exec("PRAGMA foreign_keys = OFF");
        try {
          const migrateMcp = this.db.transaction(() => {
            this.db.exec(`
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
            `);

            if (!auditAlreadySupportsMcp) {
              const before = this.db
                .prepare("SELECT COUNT(*) AS count FROM audit_log")
                .get() as { count: number };

              this.db.exec(`
                DROP TABLE IF EXISTS audit_log_new;
                CREATE TABLE audit_log_new (
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
                INSERT INTO audit_log_new (
                  id, timestamp, user_id, agent_name, action_type,
                  resource_type, resource_id, details, tmux_target, surface
                )
                SELECT
                  id, timestamp, user_id, agent_name, action_type,
                  resource_type, resource_id, details, tmux_target, surface
                FROM audit_log;
              `);

              const copied = this.db
                .prepare("SELECT COUNT(*) AS count FROM audit_log_new")
                .get() as { count: number };
              if (copied.count !== before.count) {
                throw new Error(`audit_log v36 rebuild copied ${copied.count} rows, expected ${before.count}`);
              }

              this.db.exec(`
                DROP TABLE audit_log;
                ALTER TABLE audit_log_new RENAME TO audit_log;
                CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);
                CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
                CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_name);
                CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(action_type);
              `);
            }

            const migratedAuditDefinition = this.db
              .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
              .get() as { sql: string | null } | undefined;
            if (
              !migratedAuditDefinition?.sql ||
              !/surface\s+TEXT\s+CHECK\s*\(\s*surface\s+IN\s*\([^)]*'mcp'/i.test(migratedAuditDefinition.sql)
            ) {
              throw new Error("audit_log v36 rebuild did not add the mcp surface");
            }

            const fkProblems = this.db.pragma("foreign_key_check") as unknown[];
            if (fkProblems.length > 0) {
              throw new Error(`MCP v36 migration foreign_key_check failed with ${fkProblems.length} violation(s)`);
            }
          });
          migrateMcp();
        } finally {
          this.db.exec("PRAGMA foreign_keys = ON");
        }
      }

      // Migration: v36 → v37: remove OVM tables, backup before drop
      if (current && current.version < 37) {
        const utc = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const backupPath = `${this.dbPath}.pre-ovm-drop-${utc}-${process.pid}.bak`;
        this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
        if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
          throw new Error(`v37 OVM drop aborted: pre-drop backup ${backupPath} was not written`);
        }
        this.db.exec("DROP TABLE IF EXISTS overmind_task_history");
        this.db.exec("DROP TABLE IF EXISTS overmind_workflows");
        this.db.exec("DROP TABLE IF EXISTS overmind_projects");
      }

      // Migration: v37 → v38: agent solicit reminders schema
      if (current && current.version < 38) {
        // Tables agent_solicit_reminders and agent_solicit_recipients are created via SCHEMA_SQL
        // after migrations; no data migration required for fresh-vs-upgrade parity.
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

  /** Seed the default "Notes" folder if it doesn't already exist.
   *  Called for fresh DBs and idempotently after v23 migration.
   *  created_by is set to the owner user if one exists, otherwise null. */
  private seedDefaultNotesFolder(): void {
    const existing = this.db
      .prepare("SELECT id FROM note_folders WHERE name = 'Notes' LIMIT 1")
      .get() as { id: number } | undefined;
    if (existing) return;

    const ownerUser = this.db
      .prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1")
      .get() as { id: number } | undefined;
    const ownerUserId = ownerUser?.id ?? null;

    this.db
      .prepare("INSERT INTO note_folders (name, position, created_by) VALUES ('Notes', 0, ?)")
      .run(ownerUserId);
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
