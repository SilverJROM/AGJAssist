import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AgentSolicitService } from "../../src/services/agent-solicit-service.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDirs: string[] = [];

function tempDb(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-service-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentSolicitService C2", () => {
  let db: DatabaseService;
  let service: AgentSolicitService;
  let userId: number;

  beforeEach(() => {
    const dbPath = tempDb("test.sqlite");
    db = new DatabaseService(dbPath);
    service = new AgentSolicitService(db);
    db.prepare("INSERT INTO users (telegram_id, role) VALUES (12345, 'owner')").run();
    userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;
  });

  afterEach(() => {
    db.close();
  });

  it("creates reminder with preset cadence and recipients", () => {
    const reminder = service.create({
      user_id: userId,
      folder_group: "group-a",
      cadence_minutes: 30,
      repeat_limit: null,
      solicit_message: "give me a status update",
      next_fire: "2026-01-01T00:00:00.000Z",
      recipients: [
        { agent_name: "agent-1", include: 1 },
        { agent_name: "agent-2", include: 0 },
      ],
    });

    expect(reminder.id).toBeGreaterThan(0);
    expect(reminder.folder_group).toBe("group-a");
    expect(reminder.cadence_minutes).toBe(30);
    expect(reminder.repeat_limit).toBeNull();
    expect(reminder.recipients).toHaveLength(2);
    expect(reminder.recipients.find(r => r.agent_name === "agent-1")?.include).toBe(1);
    expect(reminder.recipients.find(r => r.agent_name === "agent-2")?.include).toBe(0);
  });

  it("creates reminder with custom cadence and stop-after-N", () => {
    const reminder = service.create({
      user_id: userId,
      folder_group: "group-b",
      cadence_minutes: 45,
      repeat_limit: 5,
      recipients: [{ agent_name: "agent-x" }],
    });

    expect(reminder.cadence_minutes).toBe(45);
    expect(reminder.repeat_limit).toBe(5);
    expect(reminder.repeat_count).toBe(0);
  });

  it("lists active reminders with recipients projection", () => {
    const reminder = service.create({
      user_id: userId,
      folder_group: "g1",
      cadence_minutes: 15,
      next_fire: "2026-01-01T00:00:00.000Z",
      repeat_limit: 5,
      active: 1,
      recipients: [{ agent_name: "inc", include: 1 }, { agent_name: "skip", include: 0 }],
    });
    // Simulate repeat progress via second path
    db.prepare("UPDATE agent_solicit_reminders SET repeat_count = 2 WHERE id = ?").run(reminder.id);

    service.create({
      user_id: userId,
      folder_group: "g2",
      cadence_minutes: 60,
      active: 0,
      recipients: [{ agent_name: "a2" }],
    });

    const active = service.listActive(userId);
    expect(active).toHaveLength(1);
    const r = active[0];
    expect(r.folder_group).toBe("g1");
    expect(r.cadence_minutes).toBe(15);
    expect(r.next_fire).toBe("2026-01-01T00:00:00.000Z");
    expect(r.repeat_limit).toBe(5);
    expect(r.repeat_count).toBe(2);
    expect(r.recipients).toHaveLength(2);
    expect(r.recipients.find(x => x.agent_name === "skip")?.include).toBe(0);
    // remaining = 5 - 2 = 3
    const remaining = (r.repeat_limit ?? 0) - r.repeat_count;
    expect(remaining).toBe(3);
  });

  it("updates reminder cadence and recipients immediately", () => {
    const reminder = service.create({
      user_id: userId,
      folder_group: "g1",
      cadence_minutes: 30,
      repeat_limit: 5,
      next_fire: "2026-01-01T00:00:00.000Z",
      recipients: [{ agent_name: "a1", include: 1 }],
    });

    const updated = service.update(reminder.id, {
      cadence_minutes: 90,
      repeat_limit: null,
      next_fire: null,
      recipients: [
        { agent_name: "a1", include: 0 },
        { agent_name: "a2", include: 1 },
      ],
    });

    expect(updated?.cadence_minutes).toBe(90);
    expect(updated?.repeat_limit).toBeNull();
    expect(updated?.next_fire).toBeNull();
    expect(updated?.recipients).toHaveLength(2);
    expect(updated?.recipients.find(r => r.agent_name === "a1")?.include).toBe(0);
  });

  it("deletes reminder and cascades recipients", () => {
    const reminder = service.create({
      user_id: userId,
      folder_group: "g1",
      cadence_minutes: 30,
      recipients: [{ agent_name: "a1" }],
    });

    const ok = service.delete(reminder.id);
    expect(ok).toBe(true);
    expect(service.getById(reminder.id)).toBeNull();

    const recs = db.prepare("SELECT * FROM agent_solicit_recipients WHERE reminder_id = ?").all(reminder.id);
    expect(recs).toHaveLength(0);
  });

  it("getDueReminders returns due reminders respecting repeat limit", () => {
    // Use SQLite datetime format to catch lexical bug
    const due = service.create({
      user_id: userId,
      folder_group: "due",
      cadence_minutes: 30,
      next_fire: "2000-01-01 00:00:00",
      repeat_limit: null,
      recipients: [{ agent_name: "a1" }],
    });

    const notDue = service.create({
      user_id: userId,
      folder_group: "future",
      cadence_minutes: 30,
      next_fire: "2099-01-01 23:59:59",
      recipients: [{ agent_name: "a2" }],
    });

    const limited = service.create({
      user_id: userId,
      folder_group: "limited",
      cadence_minutes: 30,
      next_fire: "2000-01-01 00:00:00",
      repeat_limit: 1,
      recipients: [{ agent_name: "a3" }],
    });
    // Simulate repeat exhausted
    db.prepare("UPDATE agent_solicit_reminders SET repeat_count = 1 WHERE id = ?").run(limited.id);

    const dueList = service.getDueReminders();
    const ids = dueList.map(r => r.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notDue.id);
    expect(ids).not.toContain(limited.id);
  });

  it("advanceReminder increments next_fire and repeat_count", () => {
    const reminder = service.create({
      user_id: userId,
      folder_group: "advance",
      cadence_minutes: 30,
      next_fire: "2026-01-01T00:00:00.000Z",
      repeat_limit: null,
      recipients: [{ agent_name: "a1" }],
    });

    const advanced = service.advanceReminder(reminder.id);
    expect(advanced).not.toBeNull();
    expect(advanced?.repeat_count).toBe(1);
    // Literal expectation for cadence discrimination
    expect(advanced?.next_fire).toBe("2026-01-01T00:30:00.000Z");
  });

  it("advanceReminder deactivates when repeat limit reached", () => {
    const nextFire = new Date(Date.now() - 1000).toISOString();
    const reminder = service.create({
      user_id: userId,
      folder_group: "limit",
      cadence_minutes: 30,
      next_fire: nextFire,
      repeat_limit: 1,
      recipients: [{ agent_name: "a1" }],
    });

    const advanced = service.advanceReminder(reminder.id);
    expect(advanced?.active).toBe(0);
  });
});
