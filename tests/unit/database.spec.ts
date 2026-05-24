import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const TEST_DB = path.join("data", "test-db.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("DatabaseService", () => {
  afterEach(() => cleanup());

  it("creates database with all tables", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);

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

    db.close();
  });

  it("enables WAL mode", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);
    const result = db.raw.pragma("journal_mode") as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe("wal");
    db.close();
  });

  it("seeds default safety patterns", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);
    const patterns = db
      .prepare("SELECT * FROM safety_patterns")
      .all() as { pattern: string }[];

    expect(patterns.length).toBeGreaterThan(5);
    expect(patterns.some((p) => p.pattern === "rm -rf")).toBe(true);
    expect(patterns.some((p) => p.pattern === "kill -9")).toBe(true);
    db.close();
  });

  it("tracks schema version", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);
    const version = db
      .prepare("SELECT version FROM schema_version")
      .get() as { version: number };

    expect(version.version).toBe(25);
    db.close();
  });

  it("creates owner user via ensureOwner", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);
    db.ensureOwner(123456);

    const user = db
      .prepare("SELECT * FROM users WHERE telegram_id = ?")
      .get(123456) as { role: string; active: number };

    expect(user.role).toBe("owner");
    expect(user.active).toBe(1);
    db.close();
  });

  it("is idempotent on re-open", () => {
    cleanup();
    const db1 = new DatabaseService(TEST_DB);
    db1.ensureOwner(123);
    db1.close();

    const db2 = new DatabaseService(TEST_DB);
    const users = db2.prepare("SELECT * FROM users").all();
    expect(users.length).toBe(1);
    db2.close();
  });

  it("creates projects table with active column", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);

    const cols = db.raw.pragma("table_info(projects)") as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("active");

    db.close();
  });

  it("creates personal_tasks table with completed_at column", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);

    const cols = db.raw.pragma("table_info(personal_tasks)") as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("completed_at");

    db.close();
  });

  it("upgrades a v23 snapshot DB to v25 and adds last_parent_update_at + evidence_idle_threshold_override_minutes", () => {
    cleanup();
    const raw = new Database(TEST_DB);
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (23);
      CREATE TABLE overmind_workflows (
        id INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
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

    const upgraded = new DatabaseService(TEST_DB);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(25);
    const upgradedCols = upgraded.raw.pragma("table_info(overmind_workflows)") as { name: string }[];
    const upgradedColNames = upgradedCols.map((c) => c.name);
    expect(upgradedColNames).toContain("last_parent_update_at");
    expect(upgradedColNames).toContain("evidence_idle_threshold_override_minutes");
    upgraded.close();
  });
});
