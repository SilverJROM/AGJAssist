import { beforeEach, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DatabaseService } from "../../src/db/database.js";
import { AgentAssignmentService } from "../../src/services/agent-assignment-service.js";

const TEST_DB = path.join("data", "test-agent-assignments.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("AgentAssignmentService", () => {
  let db: DatabaseService;
  let service: AgentAssignmentService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    service = new AgentAssignmentService(db);
    db.prepare("INSERT INTO projects (id, directory_name, display_name) VALUES (1, 'agj', 'AGJ')").run();
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("persists agent CRUD round-trips", () => {
    const created = service.createAgent({
      name: "Codex Medium",
      provider: "codex",
      model: "gpt-5-codex",
      default_effort: "medium"
    });

    expect(created).toMatchObject({
      name: "Codex Medium",
      provider: "codex",
      model: "gpt-5-codex",
      default_effort: "medium"
    });

    const updated = service.updateAgent(created.id, {
      name: "Codex High",
      default_effort: "high"
    });
    expect(updated).toMatchObject({
      id: created.id,
      name: "Codex High",
      provider: "codex",
      model: "gpt-5-codex",
      default_effort: "high"
    });

    const reloaded = new AgentAssignmentService(db).getAgent(created.id);
    expect(reloaded).toMatchObject({
      id: created.id,
      name: "Codex High",
      provider: "codex",
      model: "gpt-5-codex",
      default_effort: "high"
    });

    expect(service.deleteAgent(created.id)).toBe(true);
    expect(service.getAgent(created.id)).toBeNull();
  });

  it("sets and reads back the exact project role binding", () => {
    const agent = service.createAgent({
      name: "Claude Validator",
      provider: "claude",
      model: "opus",
      default_effort: "medium"
    });

    const binding = service.setProjectBinding(1, "validator", agent.id);
    expect(binding).toMatchObject({
      project_id: 1,
      role: "validator",
      agent_id: agent.id,
      agent: {
        id: agent.id,
        name: "Claude Validator",
        provider: "claude",
        model: "opus",
        default_effort: "medium"
      }
    });

    const persisted = db
      .prepare("SELECT project_id, role, agent_id FROM role_bindings WHERE project_id = ? AND role = ?")
      .get(1, "validator");
    expect(persisted).toEqual({
      project_id: 1,
      role: "validator",
      agent_id: agent.id
    });
  });

  it("enforces one binding per project role", () => {
    const first = service.createAgent({
      name: "First Implementer",
      provider: "codex",
      model: "gpt-5-codex"
    });
    const second = service.createAgent({
      name: "Second Implementer",
      provider: "grok",
      model: "grok-build"
    });

    db.prepare(
      "INSERT INTO role_bindings (project_id, role, agent_id) VALUES (?, ?, ?)"
    ).run(1, "implementer", first.id);

    expect(() => {
      db.prepare(
        "INSERT INTO role_bindings (project_id, role, agent_id) VALUES (?, ?, ?)"
      ).run(1, "implementer", second.id);
    }).toThrow(/UNIQUE constraint failed/);

    const rows = db
      .prepare("SELECT project_id, role, agent_id FROM role_bindings WHERE project_id = ? AND role = ?")
      .all(1, "implementer");
    expect(rows).toEqual([{ project_id: 1, role: "implementer", agent_id: first.id }]);
  });

  it("falls back to the role default when a project role is unmapped", () => {
    const defaultAgent = service.createAgent({
      name: "Default Coord",
      provider: "claude",
      model: "sonnet"
    });
    const boundAgent = service.createAgent({
      name: "Bound Coord",
      provider: "codex",
      model: "gpt-5-codex"
    });

    service.setRoleDefault("coord", defaultAgent.id);
    expect(service.resolveProjectRole(1, "coord")).toMatchObject({
      source: "default",
      agent: { id: defaultAgent.id, name: "Default Coord" }
    });

    service.setProjectBinding(1, "coord", boundAgent.id);
    expect(service.resolveProjectRole(1, "coord")).toMatchObject({
      source: "binding",
      agent: { id: boundAgent.id, name: "Bound Coord" }
    });

    service.clearProjectBinding(1, "coord");
    expect(service.resolveProjectRole(1, "coord")).toMatchObject({
      source: "default",
      agent: { id: defaultAgent.id, name: "Default Coord" }
    });
  });

  it("returns null when neither binding nor default exists", () => {
    expect(service.resolveProjectRole(1, "redteam_1")).toBeNull();
  });
});

describe("AgentAssignmentService on upgraded v31 DB", () => {
  afterEach(() => cleanup());

  it("uses the v32 tables after migration from v31", () => {
    cleanup();
    const raw = new Database(TEST_DB);
    raw.exec(`
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
      INSERT INTO projects (id, directory_name) VALUES (1, 'agj');
    `);
    raw.close();

    const upgraded = new DatabaseService(TEST_DB);
    const upgradedService = new AgentAssignmentService(upgraded);
    const agent = upgradedService.createAgent({
      name: "Migrated DB Agent",
      provider: "grok",
      model: "grok-build"
    });
    const binding = upgradedService.setProjectBinding(1, "projcore", agent.id);

    expect(binding).toMatchObject({
      project_id: 1,
      role: "projcore",
      agent_id: agent.id
    });
    expect(upgradedService.resolveProjectRole(1, "projcore")).toMatchObject({
      source: "binding",
      agent: { id: agent.id, name: "Migrated DB Agent" }
    });

    upgraded.close();
  });
});
