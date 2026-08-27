import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const TEST_DB = path.join("data", "command-center-migration-test.sqlite");

function cleanup(): void {
  for (const f of [
    TEST_DB,
    `${TEST_DB}-wal`,
    `${TEST_DB}-shm`,
  ]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // remove any backup files created during test
  const files = fs.readdirSync(path.dirname(TEST_DB));
  for (const f of files) {
    if (f.startsWith(path.basename(TEST_DB) + ".pre-ovm-drop-")) {
      fs.unlinkSync(path.join(path.dirname(TEST_DB), f));
    }
  }
}

describe("command-center migration B7", () => {
  afterEach(() => cleanup());

  it("fresh DB has schema version 37 and no OVM tables", () => {
    cleanup();
    const db = new DatabaseService(TEST_DB);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_task_history");

    db.close();
  });

  it("upgrade from v36 backs up DB and drops OVM tables", () => {
    cleanup();
    // create a v36 DB with OVM tables
    const raw = new Database(TEST_DB);
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (36);
      CREATE TABLE overmind_projects (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        app_path TEXT UNIQUE NOT NULL,
        parent_session TEXT NOT NULL
      );
      CREATE TABLE overmind_workflows (
        id INTEGER PRIMARY KEY,
        project_id INTEGER
      );
      CREATE TABLE overmind_task_history (
        id INTEGER PRIMARY KEY,
        coordinator_session TEXT NOT NULL
      );
      INSERT INTO overmind_projects (id, slug, app_path, parent_session) VALUES (1, 'p1', '/a', 's1');
      INSERT INTO overmind_workflows (id, project_id) VALUES (1, 1);
      INSERT INTO overmind_task_history (id, coordinator_session) VALUES (1, 's1');
    `);
    raw.close();

    const db = new DatabaseService(TEST_DB);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_task_history");

    // backup file should exist as sibling
    const dir = path.dirname(TEST_DB);
    const base = path.basename(TEST_DB);
    const backups = fs.readdirSync(dir).filter(f => f.startsWith(base + ".pre-ovm-drop-") && f.endsWith(".bak"));
    expect(backups.length).toBeGreaterThan(0);

    db.close();
  });

  it("fresh and upgraded DB have same table set excluding OVM", () => {
    cleanup();
    // fresh
    const freshDbPath = path.join("data", "command-center-fresh.sqlite");
    if (fs.existsSync(freshDbPath)) fs.unlinkSync(freshDbPath);
    const fresh = new DatabaseService(freshDbPath);
    const freshTables = fresh.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    fresh.close();
    fs.unlinkSync(freshDbPath);

    // upgraded
    const raw = new Database(TEST_DB);
    raw.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (36);
      CREATE TABLE overmind_projects (id INTEGER PRIMARY KEY);
      CREATE TABLE overmind_workflows (id INTEGER PRIMARY KEY);
      CREATE TABLE overmind_task_history (id INTEGER PRIMARY KEY);
    `);
    raw.close();
    const upgraded = new DatabaseService(TEST_DB);
    const upgradedTables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    upgraded.close();

    const freshNames = freshTables.map(t => t.name);
    const upgradedNames = upgradedTables.map(t => t.name);
    expect(upgradedNames).toEqual(freshNames);
    cleanup();
  });
});
