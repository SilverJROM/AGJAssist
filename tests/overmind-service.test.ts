import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../src/db/database.js";
import { OvermindService } from "../src/services/overmind-service.js";
import Database from "better-sqlite3";
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
  it("creates the schema v22 tables, display name, active attribution, history, notification, elapsed, completion-check, per-session status, child roles, info-request, and monitoring-pause columns", () => {
    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(23);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'overmind_workflows'")
      .all();
    expect(tables).toHaveLength(1);

    const historyTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'overmind_task_history'")
      .all();
    expect(historyTables).toHaveLength(1);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'overmind_workflows'")
      .all() as { name: string }[];
    expect(indexes.map((idx) => idx.name)).toContain("idx_overmind_workflows_coordinator_session");
    expect(indexes.map((idx) => idx.name)).toContain("idx_overmind_workflows_status");

    const historyIndexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'overmind_task_history'")
      .all() as { name: string }[];
    expect(historyIndexes.map((idx) => idx.name)).toContain("idx_overmind_task_history_coordinator_session");

    const cols = db.raw.pragma("table_info(overmind_workflows)") as { name: string }[];
    const colNames = cols.map((col) => col.name);
    expect(colNames).toContain("display_name");
    expect(colNames).toContain("active_session");
    expect(colNames).toContain("active_role");
    expect(colNames).toContain("ended_at");
    expect(colNames).toContain("task_log");
    expect(colNames).toContain("last_notified_transition");
    expect(colNames).toContain("run_started_at");
    expect(colNames).toContain("accumulated_ms");
    expect(colNames).toContain("parent_status");
    expect(colNames).toContain("child_statuses");
    expect(colNames).toContain("child_roles");
    expect(colNames).toContain("info_request");
    expect(colNames).toContain("info_check");
    expect(colNames).toContain("monitoring_paused");
    expect(colNames).toContain("paused_at");
    expect(colNames).toContain("paused_by");

    const historyCols = db.raw.pragma("table_info(overmind_task_history)") as { name: string }[];
    expect(historyCols.map((col) => col.name)).toEqual([
      "id",
      "coordinator_session",
      "name",
      "at",
      "current_task",
      "done",
      "total"
    ]);
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
    expect(created.display_name).toBeNull();
    expect(created.child_sessions).toEqual(["lkcdx-may20"]);
    expect(created.tasks[0]).toEqual({ id: "A1", label: "Schema", state: "processing" });
    expect(created.active_session).toBeNull();
    expect(created.active_role).toBeNull();
    expect(created.ended_at).toBeNull();
    expect(created.run_started_at).toBeTruthy();
    expect(created.accumulated_ms).toBe(0);
    expect(created.parent_status).toBeNull();
    expect(created.child_statuses).toEqual([]);
    expect(created.task_log).toEqual([]);

    expect(service.list()).toHaveLength(1);
    expect(service.get(created.id)?.coordinator_session).toBe("lkcamp-12");
    expect(service.getBySession("lkcamp-12")?.id).toBe(created.id);

    const updated = service.update(created.id, {
      label: "lkcamp updated",
      child_sessions: ["lkcdx-may20", "lkcdx-extra"],
      pending_decision: "Choose option",
      active_session: "lkcdx-extra",
      active_role: "child",
      last_pane_hash: "abc123",
      parent_status: "idle",
      child_statuses: [
        { session: "lkcdx-may20", status: "working" },
        { session: "lkcdx-extra", status: "closed" }
      ],
      nudge_count: 2,
      tier: 1
    });

    expect(updated?.label).toBe("lkcamp updated");
    expect(updated?.child_sessions).toEqual(["lkcdx-may20", "lkcdx-extra"]);
    expect(updated?.pending_decision).toBe("Choose option");
    expect(updated?.active_session).toBe("lkcdx-extra");
    expect(updated?.active_role).toBe("child");
    expect(updated?.last_pane_hash).toBe("abc123");
    expect(updated?.parent_status).toBe("idle");
    expect(updated?.child_statuses).toEqual([
      { session: "lkcdx-may20", status: "working" },
      { session: "lkcdx-extra", status: "closed" }
    ]);
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
    expect(tasks?.task_log).toHaveLength(1);
    expect(tasks?.task_log[0]).toMatchObject({ current_task: "A1 verify", done: 1, total: 2 });

    expect(service.listHistory()).toHaveLength(1);
    expect(service.listHistory()[0]).toMatchObject({
      coordinator_session: "lkcamp-12",
      name: "lkcamp updated",
      current_task: "A1 verify",
      done: 1,
      total: 2
    });

    expect(service.delete(created.id)).toBe(true);
    expect(service.get(created.id)).toBeNull();
    expect(service.listHistory()).toHaveLength(1);
    expect(service.listHistory()[0]).toMatchObject({
      coordinator_session: "lkcamp-12",
      name: "lkcamp updated",
      current_task: "A1 verify"
    });
  });

  it("stamps ended_at when a workflow is registered with all tasks done", () => {
    const created = service.register({
      label: "v6-register-done",
      coordinator_session: "v6-register-done-parent",
      run_dir: "/tmp/overmind/v6-register-done",
      current_task: "Complete",
      tasks: [
        { id: "A1", label: "First", state: "done" },
        { id: "A2", label: "Second", state: "done" }
      ]
    });

    expect(created.ended_at).toBeTruthy();
    expect(Date.parse(created.ended_at || "")).not.toBeNaN();
  });

  it("keeps ended_at null when a workflow is registered with a pending task", () => {
    const created = service.register({
      label: "v6-register-pending",
      coordinator_session: "v6-register-pending-parent",
      run_dir: "/tmp/overmind/v6-register-pending",
      current_task: "In flight",
      tasks: [
        { id: "A1", label: "First", state: "done" },
        { id: "A2", label: "Second", state: "pending" }
      ]
    });

    expect(created.ended_at).toBeNull();
  });

  it("freezes ended_at when all tasks are done and clears it when a not-done task appears", () => {
    const created = service.register({
      label: "v6",
      coordinator_session: "v6-parent",
      run_dir: "/tmp/overmind/v6",
      current_task: "A1",
      tasks: [{ id: "A1", label: "First", state: "processing" }]
    });

    const frozen = service.setTasks(created.id, "All done", [
      { id: "A1", label: "First", state: "done" },
      { id: "A2", label: "Second", state: "done" }
    ]);

    expect(frozen?.ended_at).toBeTruthy();
    expect(Date.parse(frozen?.ended_at || "")).not.toBeNaN();

    const frozenAgain = service.setTasks(created.id, "All done", [
      { id: "A1", label: "First", state: "done" },
      { id: "A2", label: "Second", state: "done" }
    ]);
    expect(frozenAgain?.ended_at).toBe(frozen?.ended_at);

    const resumed = service.setTasks(created.id, "A3 injected", [
      { id: "A1", label: "First", state: "done" },
      { id: "A2", label: "Second", state: "done" },
      { id: "A3", label: "Injected", state: "pending" }
    ]);

    expect(resumed?.ended_at).toBeNull();
  });

  it("stamps ended_at when status is set to completed", () => {
    const created = service.register({
      label: "v6-status",
      coordinator_session: "v6-status-parent",
      run_dir: "/tmp/overmind/v6-status"
    });

    const completed = service.setStatus(created.id, "completed");

    expect(completed?.status).toBe("completed");
    expect(completed?.ended_at).toBeTruthy();
    expect(Date.parse(completed?.ended_at || "")).not.toBeNaN();
  });

  it("appends task_log on current task or done-count changes, skips no-ops, and caps at 50 entries", () => {
    const created = service.register({
      label: "v6-log",
      coordinator_session: "v6-log-parent",
      run_dir: "/tmp/overmind/v6-log",
      current_task: "A1",
      tasks: [
        { id: "A1", label: "First", state: "processing" },
        { id: "A2", label: "Second", state: "pending" }
      ]
    });

    const noOp = service.setTasks(created.id, "A1", [
      { id: "A1", label: "First", state: "processing" },
      { id: "A2", label: "Second", state: "pending" }
    ]);
    expect(noOp?.task_log).toEqual([]);
    expect(service.listHistory()).toEqual([]);

    const currentTaskChanged = service.setTasks(created.id, "A2", [
      { id: "A1", label: "First", state: "processing" },
      { id: "A2", label: "Second", state: "pending" }
    ]);
    expect(currentTaskChanged?.task_log).toHaveLength(1);
    expect(currentTaskChanged?.task_log[0]).toMatchObject({ current_task: "A2", done: 0, total: 2 });
    expect(service.listHistory()).toHaveLength(1);

    const doneChanged = service.setTasks(created.id, "A2", [
      { id: "A1", label: "First", state: "done" },
      { id: "A2", label: "Second", state: "pending" }
    ]);
    expect(doneChanged?.task_log).toHaveLength(2);
    expect(doneChanged?.task_log[1]).toMatchObject({ current_task: "A2", done: 1, total: 2 });
    expect(service.listHistory()).toHaveLength(2);

    const repeated = service.setTasks(created.id, "A2", [
      { id: "A1", label: "First", state: "done" },
      { id: "A2", label: "Second", state: "pending" }
    ]);
    expect(repeated?.task_log).toHaveLength(2);
    expect(service.listHistory()).toHaveLength(2);

    const capped = service.register({
      label: "v6-cap",
      coordinator_session: "v6-cap-parent",
      run_dir: "/tmp/overmind/v6-cap",
      current_task: "Seed",
      tasks: [{ id: "A1", label: "First", state: "pending" }]
    });

    let latest = capped;
    for (let i = 0; i < 60; i += 1) {
      latest = service.setTasks(capped.id, `Task ${i}`, [
        { id: "A1", label: "First", state: i % 2 === 0 ? "pending" : "processing" }
      ])!;
    }

    expect(latest.task_log).toHaveLength(50);
    expect(latest.task_log[0].current_task).toBe("Task 10");
    expect(latest.task_log[49].current_task).toBe("Task 59");
    expect(service.listHistory().filter((entry) => entry.coordinator_session === "v6-cap-parent")).toHaveLength(60);
  });

  it("uses the current workflow display name for registered history and snapshot name after delete", () => {
    const created = service.register({
      label: "snapshot label",
      coordinator_session: "snapshot-parent",
      run_dir: "/tmp/overmind/snapshot",
      current_task: "Seed",
      tasks: [{ id: "A1", label: "First", state: "processing" }]
    });
    service.setDisplayName(created.id, "Live display");

    service.setTasks(created.id, "Next", [
      { id: "A1", label: "First", state: "done" }
    ]);

    expect(service.listHistory()[0]).toMatchObject({
      coordinator_session: "snapshot-parent",
      name: "Live display",
      current_task: "Next",
      done: 1,
      total: 1
    });

    service.setDisplayName(created.id, "Renamed live");
    expect(service.listHistory()[0].name).toBe("Renamed live");

    expect(service.delete(created.id)).toBe(true);
    expect(service.listHistory()[0]).toMatchObject({
      coordinator_session: "snapshot-parent",
      name: "Live display",
      current_task: "Next"
    });
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
      active_session: "hrcdx-33",
      active_role: "child",
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
    expect(upserted.active_session).toBeNull();
    expect(upserted.active_role).toBeNull();
    expect(upserted.stuck_since).toBeNull();
    expect(upserted.nudge_count).toBe(0);
    expect(upserted.tier).toBe(0);
    expect(upserted.last_notified_transition).toBeNull();
    expect(service.list()).toHaveLength(1);
  });

  it("sets, trims, and clears display_name", () => {
    const created = service.register({
      label: "projcore",
      coordinator_session: "projcore-parent",
      run_dir: "/tmp/overmind/projcore"
    });

    const renamed = service.setDisplayName(created.id, "  W3 Rename Slice  ");
    expect(renamed?.display_name).toBe("W3 Rename Slice");

    const clearedByEmpty = service.setDisplayName(created.id, "   ");
    expect(clearedByEmpty?.display_name).toBeNull();

    const renamedAgain = service.setDisplayName(created.id, "Custom Name");
    expect(renamedAgain?.display_name).toBe("Custom Name");

    const clearedByNull = service.setDisplayName(created.id, null);
    expect(clearedByNull?.display_name).toBeNull();
  });

  it("preserves display_name across re-register and setTasks updates", () => {
    const created = service.register({
      label: "projcore label",
      coordinator_session: "projcore-preserve-parent",
      run_dir: "/tmp/overmind/projcore-preserve",
      current_task: "Original task",
      tasks: [{ id: "A1", label: "Original", state: "processing" }]
    });

    const renamed = service.setDisplayName(created.id, "JROM custom name");
    expect(renamed?.display_name).toBe("JROM custom name");

    const reRegistered = service.register({
      label: "projcore updated label",
      coordinator_session: "projcore-preserve-parent",
      child_sessions: ["child-a"],
      run_dir: "/tmp/overmind/projcore-preserve-rerun",
      current_task: "Rerun task",
      tasks: [{ id: "A2", label: "Rerun", state: "processing" }]
    });
    expect(reRegistered.id).toBe(created.id);
    expect(reRegistered.label).toBe("projcore updated label");
    expect(reRegistered.display_name).toBe("JROM custom name");

    const taskUpdated = service.setTasks(reRegistered.id, "Task update", [
      { id: "A2", label: "Rerun", state: "done" },
      { id: "A3", label: "Next", state: "pending" }
    ]);
    expect(taskUpdated?.display_name).toBe("JROM custom name");
    expect(taskUpdated?.current_task).toBe("Task update");
  });

  it("resets run_started_at and rolls the prior current-run elapsed into accumulated_ms on re-register", () => {
    const created = service.register({
      label: "elapsed",
      coordinator_session: "elapsed-parent",
      run_dir: "/tmp/overmind/elapsed",
      current_task: "First run",
      tasks: [{ id: "A1", label: "First", state: "processing" }]
    });
    expect(created.accumulated_ms).toBe(0);
    expect(created.run_started_at).toBeTruthy();

    const previousRunStart = new Date(Date.now() - 120_000).toISOString();
    db.prepare(
      "UPDATE overmind_workflows SET run_started_at = ?, accumulated_ms = ? WHERE id = ?"
    ).run(previousRunStart, 5_000, created.id);

    const beforeRegister = Date.now();
    const upserted = service.register({
      label: "elapsed rerun",
      coordinator_session: "elapsed-parent",
      run_dir: "/tmp/overmind/elapsed-rerun",
      current_task: "Second run",
      tasks: [{ id: "A1", label: "First", state: "processing" }]
    });
    const afterRegister = Date.now();
    const runStartedAt = Date.parse(upserted.run_started_at || "");

    expect(upserted.id).toBe(created.id);
    expect(runStartedAt).toBeGreaterThanOrEqual(beforeRegister);
    expect(runStartedAt).toBeLessThanOrEqual(afterRegister);
    expect(upserted.accumulated_ms).toBeGreaterThanOrEqual(5_000 + beforeRegister - Date.parse(previousRunStart));
    expect(upserted.accumulated_ms).toBeLessThanOrEqual(5_000 + afterRegister - Date.parse(previousRunStart) + 50);
    expect(upserted.ended_at).toBeNull();
  });

  it("rolls mixed SQLite and ISO timestamps exactly and recomputes ended_at from the new tasklist", () => {
    const created = service.register({
      label: "elapsed done",
      coordinator_session: "elapsed-done-parent",
      run_dir: "/tmp/overmind/elapsed-done"
    });

    db.prepare(
      "UPDATE overmind_workflows SET run_started_at = ?, ended_at = ?, accumulated_ms = ? WHERE id = ?"
    ).run("2026-05-21 00:00:00", "2026-05-21T00:10:00.000Z", 1_000, created.id);

    const upserted = service.register({
      label: "elapsed done rerun",
      coordinator_session: "elapsed-done-parent",
      run_dir: "/tmp/overmind/elapsed-done-rerun",
      current_task: "Complete",
      tasks: [{ id: "A1", label: "First", state: "done" }]
    });

    expect(upserted.accumulated_ms).toBe(601_000);
    expect(upserted.ended_at).toBeTruthy();
    expect(Date.parse(upserted.ended_at || "")).not.toBeNaN();
    expect(Date.parse(upserted.ended_at || "")).toBeGreaterThanOrEqual(Date.parse(upserted.run_started_at || ""));
  });

  it("migrates an existing v11 overmind table with guarded v12 ALTER columns", () => {
    db.close();
    cleanup();

    const legacy = new Database(TEST_DB);
    legacy.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (11);
      CREATE TABLE overmind_workflows (
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
      INSERT INTO overmind_workflows (
        label,
        coordinator_session,
        child_sessions,
        run_dir,
        status,
        tasks
      ) VALUES ('legacy', 'legacy-parent', '["legacy-child"]', '/tmp/legacy', 'active', '[]');
    `);
    legacy.close();

    db = new DatabaseService(TEST_DB);
    service = new OvermindService(db);

    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(23);

    let cols = db.raw.pragma("table_info(overmind_workflows)") as { name: string }[];
    expect(cols.map((col) => col.name)).toContain("display_name");
    expect(cols.map((col) => col.name)).toContain("active_session");
    expect(cols.map((col) => col.name)).toContain("active_role");
    expect(cols.map((col) => col.name)).toContain("ended_at");
    expect(cols.map((col) => col.name)).toContain("task_log");
    expect(cols.map((col) => col.name)).toContain("last_notified_transition");
    expect(cols.map((col) => col.name)).toContain("run_started_at");
    expect(cols.map((col) => col.name)).toContain("accumulated_ms");
    expect(cols.map((col) => col.name)).toContain("completion_check");
    expect(cols.map((col) => col.name)).toContain("parent_status");
    expect(cols.map((col) => col.name)).toContain("child_statuses");
    expect(cols.map((col) => col.name)).toContain("child_roles");
    expect(cols.map((col) => col.name)).toContain("info_request");
    expect(cols.map((col) => col.name)).toContain("info_check");
    expect(service.getBySession("legacy-parent")?.child_roles).toEqual([]);
    expect(service.getBySession("legacy-parent")?.info_request).toBeNull();
    expect(service.getBySession("legacy-parent")?.info_check).toBeNull();
    expect(service.getBySession("legacy-parent")?.monitoring_paused).toBe(false);
    expect(service.getBySession("legacy-parent")?.paused_at).toBeNull();
    expect(service.getBySession("legacy-parent")?.active_session).toBeNull();
    expect(service.getBySession("legacy-parent")?.ended_at).toBeNull();
    expect(service.getBySession("legacy-parent")?.task_log).toEqual([]);
    expect(service.getBySession("legacy-parent")?.last_notified_transition).toBeNull();
    expect(service.getBySession("legacy-parent")?.run_started_at).toBeTruthy();
    expect(service.getBySession("legacy-parent")?.run_started_at).toBe(service.getBySession("legacy-parent")?.created_at);
    expect(service.getBySession("legacy-parent")?.accumulated_ms).toBe(0);
    expect(service.getBySession("legacy-parent")?.display_name).toBeNull();
    expect(service.getBySession("legacy-parent")?.parent_status).toBeNull();
    expect(service.getBySession("legacy-parent")?.child_statuses).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'overmind_task_history'").all()).toHaveLength(1);

    db.close();
    db = new DatabaseService(TEST_DB);
    cols = db.raw.pragma("table_info(overmind_workflows)") as { name: string }[];
    const historyCols = db.raw.pragma("table_info(overmind_task_history)") as { name: string }[];
    expect(cols.filter((col) => col.name === "display_name")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "active_session")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "active_role")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "ended_at")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "task_log")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "last_notified_transition")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "run_started_at")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "accumulated_ms")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "completion_check")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "parent_status")).toHaveLength(1);
    expect(cols.filter((col) => col.name === "child_statuses")).toHaveLength(1);
    expect(historyCols.filter((col) => col.name === "coordinator_session")).toHaveLength(1);
  });

  it("listRuns() returns only terminal workflows ordered by ended_at desc, computing done_tasks/total_tasks from tasks JSON", () => {
    const active = service.register({
      label: "active-run",
      coordinator_session: "active-run-parent",
      run_dir: "/tmp/active-run",
      tasks: [{ id: "T1", label: "Task 1", state: "processing" }]
    });

    const completed1 = service.register({
      label: "completed-run-1",
      coordinator_session: "completed-run-1-parent",
      run_dir: "/tmp/completed-run-1",
      tasks: [
        { id: "A1", label: "Task A", state: "done" },
        { id: "A2", label: "Task B", state: "done" },
        { id: "A3", label: "Task C", state: "pending" }
      ]
    });
    service.setStatus(completed1.id, "completed");

    const completed2 = service.register({
      label: "completed-run-2",
      coordinator_session: "completed-run-2-parent",
      run_dir: "/tmp/completed-run-2",
      tasks: [
        { id: "B1", label: "Task B1", state: "done" }
      ]
    });
    service.setStatus(completed2.id, "completed");

    const failed = service.register({
      label: "failed-run",
      coordinator_session: "failed-run-parent",
      run_dir: "/tmp/failed-run",
      tasks: []
    });
    service.setStatus(failed.id, "failed");

    const runs = service.listRuns();

    // only terminal workflows (completed / failed), not active
    expect(runs.map((r) => r.coordinator_session)).not.toContain("active-run-parent");
    expect(runs.length).toBe(3);

    // every run has the expected shape
    for (const run of runs) {
      expect(run).toHaveProperty("id");
      expect(run).toHaveProperty("label");
      expect(run).toHaveProperty("display_name");
      expect(run).toHaveProperty("coordinator_session");
      expect(run).toHaveProperty("status");
      expect(run).toHaveProperty("run_started_at");
      expect(run).toHaveProperty("ended_at");
      expect(run).toHaveProperty("total_tasks");
      expect(run).toHaveProperty("done_tasks");
    }

    // statuses are terminal only
    for (const run of runs) {
      expect(["completed", "failed"]).toContain(run.status);
    }

    // done_tasks / total_tasks computed correctly
    const run1 = runs.find((r) => r.coordinator_session === "completed-run-1-parent")!;
    expect(run1.total_tasks).toBe(3);
    expect(run1.done_tasks).toBe(2);

    const run2 = runs.find((r) => r.coordinator_session === "completed-run-2-parent")!;
    expect(run2.total_tasks).toBe(1);
    expect(run2.done_tasks).toBe(1);

    const runFailed = runs.find((r) => r.coordinator_session === "failed-run-parent")!;
    expect(runFailed.total_tasks).toBe(0);
    expect(runFailed.done_tasks).toBe(0);
  });

  it("listRuns() uses display_name when set", () => {
    const wf = service.register({
      label: "display-run",
      coordinator_session: "display-run-parent",
      run_dir: "/tmp/display-run"
    });
    service.setDisplayName(wf.id, "My Custom Run Name");
    service.setStatus(wf.id, "completed");

    const runs = service.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].display_name).toBe("My Custom Run Name");
    expect(runs[0].label).toBe("display-run");
  });

  it("listHistory() with session filter returns only entries for that session", () => {
    const wf1 = service.register({
      label: "session-filter-1",
      coordinator_session: "sf-session-1",
      run_dir: "/tmp/sf-1",
      current_task: "T1",
      tasks: [{ id: "A1", label: "A1", state: "processing" }]
    });
    const wf2 = service.register({
      label: "session-filter-2",
      coordinator_session: "sf-session-2",
      run_dir: "/tmp/sf-2",
      current_task: "T2",
      tasks: [{ id: "B1", label: "B1", state: "processing" }]
    });

    // generate history entries for both
    service.setTasks(wf1.id, "T1-done", [{ id: "A1", label: "A1", state: "done" }]);
    service.setTasks(wf2.id, "T2-done", [{ id: "B1", label: "B1", state: "done" }]);

    const allHistory = service.listHistory();
    expect(allHistory.length).toBe(2);

    const filtered = service.listHistory("sf-session-1");
    expect(filtered.length).toBe(1);
    expect(filtered[0].coordinator_session).toBe("sf-session-1");

    const filtered2 = service.listHistory("sf-session-2");
    expect(filtered2.length).toBe(1);
    expect(filtered2[0].coordinator_session).toBe("sf-session-2");

    const noMatch = service.listHistory("nonexistent-session");
    expect(noMatch.length).toBe(0);
  });
});
