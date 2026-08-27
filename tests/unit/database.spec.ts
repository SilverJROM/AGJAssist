import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-db-test-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("DatabaseService", () => {

  it("creates database with all tables", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));

    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("users");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("tmux_sessions");
    expect(tableNames).toContain("notes");
    expect(tableNames).toContain("plans");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("safety_patterns");
    expect(tableNames).toContain("audit_log");
    expect(tableNames).toContain("conversations");
    expect(tableNames).toContain("terminal_groups");
    expect(tableNames).toContain("mcp_clients");
    expect(tableNames).toContain("mcp_grants");
    expect(tableNames).toContain("mcp_tokens");
    expect(tableNames).toContain("mcp_authorization_codes");
    expect(tableNames).toContain("mcp_grantable_pool");

    db.close();
  });

  it("enables WAL mode", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));
    const result = db.raw.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
    db.close();
  });

  it("seeds default safety patterns", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));
    const patterns = db
      .prepare("SELECT * FROM safety_patterns")
      .all() as { pattern: string }[];

    expect(patterns.length).toBeGreaterThan(5);
    expect(patterns.some((p) => p.pattern === "rm -rf")).toBe(true);
    expect(patterns.some((p) => p.pattern === "kill -9")).toBe(true);
    db.close();
  });

  it("tracks schema version", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));
    const version = db
      .prepare("SELECT version FROM schema_version")
      .get() as { version: number };

    expect(version.version).toBe(37);
    db.close();
  });

  it("fresh DB accepts audit_log surface mcp and rejects an unknown surface", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));
    db.prepare(
      "INSERT INTO audit_log (action_type, surface) VALUES (?, ?)"
    ).run("mcp_test", "mcp");
    const row = db
      .prepare("SELECT surface FROM audit_log WHERE action_type = ?")
      .get("mcp_test") as { surface: string };
    expect(row.surface).toBe("mcp");
    expect(() =>
      db.prepare("INSERT INTO audit_log (action_type, surface) VALUES (?, ?)").run("mcp_test_bad", "evil")
    ).toThrow();
    db.close();
  });

  it("creates owner user via ensureOwner", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));
    db.ensureOwner(123456);

    const user = db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(123456) as { role: string; active: number };

    expect(user.role).toBe("owner");
    expect(user.active).toBe(1);
    db.close();
  });

  it("is idempotent on re-open", () => {
    // cleanup removed; temp dirs handled by afterEach
    const dbPath = tempDb("test-db.sqlite");
    const db1 = new DatabaseService(dbPath);
    db1.ensureOwner(123);
    db1.close();

    const db2 = new DatabaseService(dbPath);
    const users = db2.prepare("SELECT * FROM users").all();
    expect(users.length).toBe(1);
    db2.close();
  });

  it("creates projects table with active column", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));

    const cols = db.raw.pragma("table_info(projects)") as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("active");

    db.close();
  });

  it("creates personal_tasks table with completed_at column", () => {
    // cleanup removed; temp dirs handled by afterEach
    const db = new DatabaseService(tempDb("test-db.sqlite"));

    const cols = db.raw.pragma("table_info(personal_tasks)") as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("completed_at");

    db.close();
  });

  it("upgrades a v23 snapshot DB to current and drops overmind tables", () => {
    // cleanup removed; temp dirs handled by afterEach
    const dbPath = tempDb("test-db.sqlite");
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (23);
      CREATE TABLE overmind_workflows (
        id INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        display_name TEXT,
        coordinator_session TEXT NOT NULL UNIQUE,
        child_sessions TEXT NOT NULL DEFAULT '[]',
        child_roles TEXT NOT NULL DEFAULT '[]',
        run_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        current_task TEXT,
        tasks TEXT NOT NULL DEFAULT '[]',
        pending_decision TEXT,
        active_session TEXT,
        active_role TEXT,
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    raw.close();

    const upgraded = new DatabaseService(dbPath);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);
    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_projects");
    upgraded.close();
  });

  it("upgrades a v31 DB to current with agent tables and leaves existing project rows intact", () => {
    // cleanup removed; temp dirs handled by afterEach
    const dbPath = tempDb("test-db.sqlite");
    const raw = new Database(dbPath);
    raw.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (31);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        directory_name TEXT UNIQUE NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO projects (id, directory_name, display_name)
      VALUES (7, 'existing-project', 'Existing Project');
    `);
    raw.close();

    const upgraded = new DatabaseService(dbPath);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tableNames = (
      upgraded.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tableNames).toContain("agents");
    expect(tableNames).toContain("role_bindings");
    expect(tableNames).toContain("role_defaults");
    expect(tableNames).toContain("agent_wake_schedule");

    const project = upgraded
      .prepare("SELECT id, directory_name, display_name, status, active FROM projects WHERE id = 7")
      .get() as {
      id: number;
      directory_name: string;
      display_name: string;
      status: string;
      active: number;
    };
    expect(project).toEqual({
      id: 7,
      directory_name: "existing-project",
      display_name: "Existing Project",
      status: "active",
      active: 1
    });

    upgraded.close();
  });

  it("upgrades v27 DB and drops overmind tables", () => {
    // cleanup removed; temp dirs handled by afterEach
    const dbPath = tempDb("test-db.sqlite");
    const raw = new Database(dbPath);
    raw.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (27);
      CREATE TABLE overmind_projects (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        app_path TEXT UNIQUE NOT NULL,
        parent_session TEXT NOT NULL,
        notes TEXT,
        created_by TEXT NOT NULL DEFAULT 'JROM',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO overmind_projects (id, slug, app_path, parent_session, notes)
      VALUES (1, 'agj', '/home/agjrom/TGBOTS/AGJAssist', 'AGJ-51', 'seed project');
      CREATE TABLE overmind_workflows (
        id INTEGER PRIMARY KEY,
        project_id INTEGER REFERENCES overmind_projects(id),
        label TEXT NOT NULL,
        display_name TEXT,
        coordinator_session TEXT NOT NULL UNIQUE,
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
      CREATE INDEX idx_overmind_workflows_coordinator_session ON overmind_workflows(coordinator_session);
      CREATE INDEX idx_overmind_workflows_status ON overmind_workflows(status);
      CREATE INDEX idx_overmind_workflows_project_id ON overmind_workflows(project_id);
      CREATE INDEX idx_overmind_workflows_project_status ON overmind_workflows(project_id, status);
      INSERT INTO overmind_workflows (
        id, project_id, label, display_name, coordinator_session, child_sessions,
        child_roles, run_dir, status, current_task, tasks, pending_decision,
        active_session, active_role, ended_at, task_log, last_pane_hash,
        last_activity_at, stuck_since, nudge_count, tier, last_notified_transition,
        run_started_at, accumulated_ms, completion_check, parent_status,
        child_statuses, info_request, info_check, monitoring_paused, paused_at,
        paused_by, last_parent_update_at, evidence_idle_threshold_override_minutes,
        created_at, updated_at
      ) VALUES (
        10, 1, 'workflow one', 'Display One', 'coord-one', '["child-a"]',
        '["coder"]', '/tmp/agj/run-one', 'working', 'B12c', '[{"id":"B12c","label":"Identity","state":"processing"}]', 'decision?',
        'child-a', 'child', NULL, '[{"at":"2026-06-01T00:00:00Z","current_task":"B12c","done":0,"total":1}]', 'hash-one',
        '2026-06-01T00:01:00.000Z', '2026-06-01T00:02:00.000Z', 3, 2, 'notify-one',
        '2026-06-01T00:00:00.000Z', 1234, 'check-one', 'idle',
        '[{"session":"child-a","status":"working"}]', 'roles', 'info-check', 1, '2026-06-01T00:03:00.000Z',
        'projcore-relay', '2026-06-01T00:04:00.000Z', 35,
        '2026-06-01T00:00:00.000Z', '2026-06-01T00:05:00.000Z'
      );
      INSERT INTO overmind_workflows (id, project_id, label, coordinator_session, run_dir, status, tasks)
      VALUES (11, NULL, 'legacy workflow', 'coord-legacy', '/tmp/legacy/run', 'active', '[]');
    `);
    raw.close();

    const upgraded = new DatabaseService(dbPath);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_task_history");

    expect((upgraded.raw.pragma("foreign_keys") as Array<{ foreign_keys: number }>)[0].foreign_keys).toBe(1);
    expect(upgraded.raw.pragma("foreign_key_check")).toEqual([]);
    upgraded.close();
  });
});
