import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../src/db/database.js";
import { OvermindService } from "../src/services/overmind-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-overmind-service.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

let db: DatabaseService;
let service: OvermindService;

beforeEach(() => {
  cleanup();
  db = new DatabaseService(TEST_DB);
  service = new OvermindService(db);
});

afterEach(() => {
  db.close();
  cleanup();
});

describe("OvermindService", () => {
  it("creates the schema v11 table and indexes", () => {
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(11);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'overmind_workflows'")
      .all();
    expect(tables).toHaveLength(1);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'overmind_workflows'")
      .all() as { name: string }[];
    expect(indexes.map((idx) => idx.name)).toContain("idx_overmind_workflows_coordinator_session");
    expect(indexes.map((idx) => idx.name)).toContain("idx_overmind_workflows_status");
  });

  it("round-trips register, list, get, getBySession, updates, status, tasks, and delete", () => {
    const created = service.register({
      label: "lkcamp",
      coordinator_session: "lkcamp-12",
      child_sessions: ["lkcdx-may20"],
      run_dir: "/tmp/overmind/lkcamp",
      current_task: "A1 schema",
      tasks: [
        { id: "A1", label: "Schema", state: "processing" },
        { id: "A2", label: "Endpoints", state: "pending" }
      ]
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe("active");
    expect(created.child_sessions).toEqual(["lkcdx-may20"]);
    expect(created.tasks[0]).toEqual({ id: "A1", label: "Schema", state: "processing" });

    expect(service.list()).toHaveLength(1);
    expect(service.get(created.id)?.coordinator_session).toBe("lkcamp-12");
    expect(service.getBySession("lkcamp-12")?.id).toBe(created.id);

    const updated = service.update(created.id, {
      label: "lkcamp updated",
      child_sessions: ["lkcdx-may20", "lkcdx-extra"],
      pending_decision: "Choose option",
      last_pane_hash: "abc123",
      nudge_count: 2,
      tier: 1
    });

    expect(updated?.label).toBe("lkcamp updated");
    expect(updated?.child_sessions).toEqual(["lkcdx-may20", "lkcdx-extra"]);
    expect(updated?.pending_decision).toBe("Choose option");
    expect(updated?.last_pane_hash).toBe("abc123");
    expect(updated?.nudge_count).toBe(2);
    expect(updated?.tier).toBe(1);

    const status = service.setStatus(created.id, "working");
    expect(status?.status).toBe("working");
    expect(service.list("working")).toHaveLength(1);
    expect(service.list("active")).toHaveLength(0);

    const tasks = service.setTasks(created.id, "A1 verify", [
      { id: "A1", label: "Schema", state: "done" },
      { id: "A2", label: "Endpoints", state: "pending" }
    ]);
    expect(tasks?.current_task).toBe("A1 verify");
    expect(tasks?.tasks).toEqual([
      { id: "A1", label: "Schema", state: "done" },
      { id: "A2", label: "Endpoints", state: "pending" }
    ]);

    expect(service.delete(created.id)).toBe(true);
    expect(service.get(created.id)).toBeNull();
  });

  it("upserts by coordinator_session and resets the workflow to active", () => {
    const created = service.register({
      label: "hris",
      coordinator_session: "hris-d-22",
      child_sessions: ["hrcdx-33"],
      run_dir: "/tmp/overmind/hris"
    });

    service.update(created.id, {
      status: "stuck",
      pending_decision: "Need input",
      stuck_since: "2026-05-21T12:00:00Z",
      nudge_count: 3,
      tier: 2
    });

    const upserted = service.register({
      label: "hris rerun",
      coordinator_session: "hris-d-22",
      child_sessions: ["hrcdx-33", "hrcdx-34"],
      run_dir: "/tmp/overmind/hris-rerun",
      current_task: "Restarted",
      tasks: [{ id: "A1", label: "Restart", state: "processing" }]
    });

    expect(upserted.id).toBe(created.id);
    expect(upserted.label).toBe("hris rerun");
    expect(upserted.status).toBe("active");
    expect(upserted.child_sessions).toEqual(["hrcdx-33", "hrcdx-34"]);
    expect(upserted.run_dir).toBe("/tmp/overmind/hris-rerun");
    expect(upserted.current_task).toBe("Restarted");
    expect(upserted.tasks).toEqual([{ id: "A1", label: "Restart", state: "processing" }]);
    expect(upserted.pending_decision).toBeNull();
    expect(upserted.stuck_since).toBeNull();
    expect(upserted.nudge_count).toBe(0);
    expect(upserted.tier).toBe(0);
    expect(service.list()).toHaveLength(1);
  });
});
