import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-summary-schema-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createLegacyV38Fixture(dbPath: string): void {
  const raw = new Database(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (38);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer'
    );
  `);
  raw.close();
}

describe("summary-schema D1", () => {
  it("fresh DB has schema version 39 and summary tables", () => {
    const dbPath = tempDb("fresh.sqlite");
    const db = new DatabaseService(dbPath);
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(39);

    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("summary_llm_endpoints");
    expect(names).toContain("agent_summaries");

    const cols = db.raw.pragma("table_info(summary_llm_endpoints)") as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain("name");
    expect(colNames).toContain("base_url");
    expect(colNames).toContain("model");
    expect(colNames).toContain("is_default");
    expect(colNames).toContain("provenance");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");

    const sumCols = db.raw.pragma("table_info(agent_summaries)") as Array<{ name: string }>;
    const sumColNames = sumCols.map(c => c.name);
    expect(sumColNames).toContain("agent_name");
    expect(sumColNames).toContain("endpoint_id");
    expect(sumColNames).toContain("summary_text");
    expect(sumColNames).toContain("provenance");
    expect(sumColNames).toContain("created_at");
    expect(sumColNames).toContain("updated_at");

    db.close();
  });

  it("upgrade from v38 creates summary tables", () => {
    const upgradePath = tempDb("upgrade.sqlite");
    createLegacyV38Fixture(upgradePath);
    const upgraded = new DatabaseService(upgradePath);
    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(39);

    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("summary_llm_endpoints");
    expect(names).toContain("agent_summaries");
    upgraded.close();
  });

  it("summary_llm_endpoints supports default provenance timestamps and no secret columns", () => {
    const dbPath = tempDb("test.sqlite");
    const db = new DatabaseService(dbPath);

    // Insert an endpoint with is_default = 1
    db.prepare(`
      INSERT INTO summary_llm_endpoints (name, base_url, model, is_default, provenance)
      VALUES ('local-140', 'http://localhost:8080/v1', 'granite-3b', 1, 'seed')
    `).run();

    const ep = db.prepare("SELECT * FROM summary_llm_endpoints WHERE name = ?").get('local-140') as any;
    expect(ep.name).toBe('local-140');
    expect(ep.base_url).toBe('http://localhost:8080/v1');
    expect(ep.model).toBe('granite-3b');
    expect(ep.is_default).toBe(1);
    expect(ep.provenance).toBe('seed');
    expect(ep.created_at).toBeTruthy();
    expect(ep.updated_at).toBeTruthy();

    // Ensure no plaintext secret column exists
    const cols = db.raw.pragma("table_info(summary_llm_endpoints)") as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain("api_key");
    expect(colNames).not.toContain("secret");

    // Insert a summary referencing the endpoint
    db.prepare(`
      INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance)
      VALUES (?, ?, ?, ?)
    `).run('agent-1', ep.id, 'short summary', 'system');

    const sumRow = db.prepare("SELECT * FROM agent_summaries WHERE endpoint_id = ?").get(ep.id) as any;
    expect(sumRow.agent_name).toBe('agent-1');
    expect(sumRow.summary_text).toBe('short summary');
    expect(sumRow.provenance).toBe('system');
    expect(sumRow.created_at).toBeTruthy();

    db.close();
  });
});
