import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-cc-migration-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql.replace(/\s+/g, " ").replace(/\s*([(),=])\s*/g, "$1").trim();
}

function schemaFingerprint(db: Database.Database) {
  const rows = db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name`
  ).all() as Array<{ type: string; name: string; tbl_name: string | null; sql: string | null }>;
  return rows.map(r => ({ ...r, sql: normalizeSql(r.sql) }));
}

describe("command-center migration B7", () => {
  it("fresh DB has schema version 37 and no OVM tables", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_task_history");
    db.close();
  });

  it("upgrade from v36 backs up DB and drops OVM tables with WAL content captured", () => {
    const dbPath = tempDb("upgrade.sqlite");
    // create v36 DB with OVM tables, leave connection open to keep WAL uncheckpointed
    const raw = new Database(dbPath);
    raw.pragma("journal_mode = WAL");
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
    // keep raw open so changes may sit in WAL

    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(37);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).not.toContain("overmind_projects");
    expect(names).not.toContain("overmind_workflows");
    expect(names).not.toContain("overmind_task_history");

    // find backup file created as sibling
    const dir = path.dirname(dbPath);
    const base = path.basename(dbPath);
    const backups = fs.readdirSync(dir).filter(f => f.startsWith(base + ".pre-ovm-drop-") && f.endsWith(".bak"));
    expect(backups.length).toBeGreaterThan(0);
    const backupPath = path.join(dir, backups[0]);
    expect(fs.statSync(backupPath).size).toBeGreaterThan(0);

    // verify backup contains the OVM rows via independent readonly connection
    const bak = new Database(backupPath, { readonly: true });
    const proj = bak.prepare("SELECT slug FROM overmind_projects ORDER BY id").all() as Array<{ slug: string }>;
    expect(proj).toEqual([{ slug: "p1" }]);
    const wf = bak.prepare("SELECT id FROM overmind_workflows ORDER BY id").all() as Array<{ id: number }>;
    expect(wf).toEqual([{ id: 1 }]);
    const th = bak.prepare("SELECT coordinator_session FROM overmind_task_history ORDER BY id").all() as Array<{ coordinator_session: string }>;
    expect(th).toEqual([{ coordinator_session: "s1" }]);
    bak.close();

    raw.close();
    db.close();
  });

  it("fresh and upgraded DB converge to same schema fingerprint", () => {
    const freshPath = tempDb("fresh.sqlite");
    const fresh = new DatabaseService(freshPath);
    const freshFp = schemaFingerprint(fresh.raw);
    fresh.close();

    const upgradePath = tempDb("upgrade.sqlite");
    // Build a realistic v36 DB by creating a fresh DB then downgrading version and adding OVM tables
    const tmp = new DatabaseService(upgradePath);
    tmp.close();
    const raw = new Database(upgradePath);
    raw.pragma("journal_mode = WAL");
    raw.exec("UPDATE schema_version SET version = 36");
    raw.exec(`
      CREATE TABLE IF NOT EXISTS overmind_projects (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        app_path TEXT UNIQUE NOT NULL,
        parent_session TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS overmind_workflows (
        id INTEGER PRIMARY KEY,
        project_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS overmind_task_history (
        id INTEGER PRIMARY KEY,
        coordinator_session TEXT NOT NULL
      );
    `);
    raw.exec(`INSERT INTO overmind_projects VALUES (1, 'p1', '/a', 's1');`);
    raw.exec(`INSERT INTO overmind_workflows VALUES (1, 1);`);
    raw.exec(`INSERT INTO overmind_task_history VALUES (1, 's1');`);
    // keep raw open for WAL realism, but we will close after upgrade
    const upgraded = new DatabaseService(upgradePath);
    const upgradedFp = schemaFingerprint(upgraded.raw);
    upgraded.close();
    raw.close();

    expect(upgradedFp).toEqual(freshFp);
  });
});
