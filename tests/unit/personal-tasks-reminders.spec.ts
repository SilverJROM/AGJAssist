import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { PersonalTaskService } from "../../src/services/personal-task-service.js";
import { ReminderService } from "../../src/services/reminder-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-personal-tasks.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

let db: DatabaseService;
let auditService: AuditService;
let taskService: PersonalTaskService;
let reminderService: ReminderService;
let userId: number;

beforeEach(() => {
  cleanup();
  db = new DatabaseService(TEST_DB);
  auditService = new AuditService(db);
  taskService = new PersonalTaskService(db, auditService);
  reminderService = new ReminderService(db, auditService);
  db.prepare(
    "INSERT INTO users (telegram_id, username, role, active) VALUES (?, ?, ?, ?)"
  ).run(12345, "testuser", "owner", 1);
  userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;
});

afterEach(() => {
  db.close();
  cleanup();
});

// ===================== PERSONAL TASK TESTS =====================

describe("PersonalTaskService", () => {
  it("creates a daily task", () => {
    const task = taskService.create({ title: "Morning standup", frequency: "daily", createdBy: userId });
    expect(task.id).toBeGreaterThan(0);
    expect(task.title).toBe("Morning standup");
    expect(task.frequency).toBe("daily");
    expect(task.active).toBe(1);
  });

  it("creates a weekly task with day_of_week", () => {
    const task = taskService.create({ title: "Weekly review", frequency: "weekly", day_of_week: 1, createdBy: userId });
    expect(task.frequency).toBe("weekly");
    expect(task.day_of_week).toBe(1);
  });

  it("creates a one-time task with due_date", () => {
    const task = taskService.create({ title: "Submit report", frequency: "once", due_date: "2026-03-15", createdBy: userId });
    expect(task.frequency).toBe("once");
    expect(task.due_date).toBe("2026-03-15");
  });

  it("lists tasks for a user", () => {
    taskService.create({ title: "Task 1", frequency: "daily", createdBy: userId });
    taskService.create({ title: "Task 2", frequency: "weekly", createdBy: userId });
    taskService.create({ title: "Task 3", frequency: "once", createdBy: userId });

    const all = taskService.list(userId);
    expect(all).toHaveLength(3);

    const daily = taskService.list(userId, "daily");
    expect(daily).toHaveLength(1);
    expect(daily[0].title).toBe("Task 1");
  });

  it("toggles completion for daily task", () => {
    const task = taskService.create({ title: "Daily", frequency: "daily", createdBy: userId });
    const today = new Date().toISOString().slice(0, 10);

    // Complete
    const result1 = taskService.toggleCompletion(task.id, today);
    expect(result1).toBe(true);

    // Check status
    const tasks = taskService.list(userId, "daily");
    expect(tasks[0].completed_today).toBe(true);

    // Uncomplete
    const result2 = taskService.toggleCompletion(task.id, today);
    expect(result2).toBe(false);

    const tasks2 = taskService.list(userId, "daily");
    expect(tasks2[0].completed_today).toBe(false);
  });

  it("toggles completion for once task", () => {
    const task = taskService.create({ title: "Once", frequency: "once", createdBy: userId });
    const today = new Date().toISOString().slice(0, 10);

    taskService.toggleCompletion(task.id, today);
    const tasks = taskService.list(userId, "once");
    expect(tasks[0].completed).toBe(true);
  });

  it("updates task", () => {
    const task = taskService.create({ title: "Old", frequency: "daily", createdBy: userId });
    const updated = taskService.update(task.id, { title: "New" }, userId);
    expect(updated?.title).toBe("New");
  });

  it("deletes task and completions", () => {
    const task = taskService.create({ title: "Delete me", frequency: "daily", createdBy: userId });
    taskService.toggleCompletion(task.id, "2026-03-09");

    expect(taskService.delete(task.id, userId)).toBe(true);
    expect(taskService.getById(task.id)).toBeNull();

    const completions = db.prepare("SELECT * FROM personal_task_completions WHERE task_id = ?").all(task.id);
    expect(completions).toHaveLength(0);
  });

  it("getCompletions returns date range", () => {
    const task = taskService.create({ title: "Track", frequency: "daily", createdBy: userId });
    taskService.toggleCompletion(task.id, "2026-03-01");
    taskService.toggleCompletion(task.id, "2026-03-05");
    taskService.toggleCompletion(task.id, "2026-03-10");

    const completions = taskService.getCompletions(task.id, "2026-03-01", "2026-03-07");
    expect(completions).toHaveLength(2);
    expect(completions[0].completed_date).toBe("2026-03-01");
    expect(completions[1].completed_date).toBe("2026-03-05");
  });
});

// ===================== REMINDER TESTS =====================

describe("ReminderService", () => {
  it("creates a reminder", () => {
    const r = reminderService.create({
      title: "Team meeting",
      event_date: "2026-03-15T10:00:00",
      reminder_1: "2026-03-15T09:30:00",
      createdBy: userId
    });
    expect(r.id).toBeGreaterThan(0);
    expect(r.title).toBe("Team meeting");
    expect(r.sent_1).toBe(0);
    expect(r.sent_event).toBe(0);
  });

  it("lists active reminders", () => {
    reminderService.create({ title: "R1", event_date: "2026-03-15T10:00:00", createdBy: userId });
    reminderService.create({ title: "R2", event_date: "2026-03-16T10:00:00", createdBy: userId });

    const active = reminderService.list(userId);
    expect(active).toHaveLength(2);
  });

  it("lists all including inactive", () => {
    const r = reminderService.create({ title: "R1", event_date: "2026-03-15T10:00:00", createdBy: userId });
    reminderService.update(r.id, { active: 0 }, userId);

    expect(reminderService.list(userId)).toHaveLength(0);
    expect(reminderService.listAll(userId)).toHaveLength(1);
  });

  it("updates a reminder", () => {
    const r = reminderService.create({ title: "Old", event_date: "2026-03-15T10:00:00", createdBy: userId });
    const updated = reminderService.update(r.id, { title: "New" }, userId);
    expect(updated?.title).toBe("New");
  });

  it("deletes a reminder", () => {
    const r = reminderService.create({ title: "Delete", event_date: "2026-03-15T10:00:00", createdBy: userId });
    expect(reminderService.delete(r.id, userId)).toBe(true);
    expect(reminderService.getById(r.id)).toBeNull();
  });

  it("finds due reminders", () => {
    // Past event - should be due
    reminderService.create({
      title: "Past event",
      event_date: "2020-01-01T00:00:00",
      reminder_1: "2019-12-31T00:00:00",
      createdBy: userId
    });

    // Future event - not due
    reminderService.create({
      title: "Future",
      event_date: "2099-01-01T00:00:00",
      createdBy: userId
    });

    const due = reminderService.getDueReminders();
    expect(due.length).toBeGreaterThanOrEqual(2); // reminder_1 + event for past
    expect(due.some(d => d.type === "event" && d.reminder.title === "Past event")).toBe(true);
    expect(due.some(d => d.type === "reminder_1" && d.reminder.title === "Past event")).toBe(true);
  });

  it("marks reminder as sent", () => {
    const r = reminderService.create({
      title: "Mark",
      event_date: "2020-01-01T00:00:00",
      reminder_1: "2019-12-31T00:00:00",
      createdBy: userId
    });

    reminderService.markSent(r.id, "reminder_1");
    const updated = reminderService.getById(r.id);
    expect(updated?.sent_1).toBe(1);
    expect(updated?.sent_event).toBe(0);
  });
});

// ===================== PERSONAL TASK ITEMS (sub-items) =====================

describe("PersonalTaskService - Items", () => {
  it("adds sub-items to a task", () => {
    const task = taskService.create({ title: "Morning routine", frequency: "daily", createdBy: userId });
    const item1 = taskService.addItem(task.id, "Brush teeth");
    const item2 = taskService.addItem(task.id, "Make bed");

    expect(item1.task_id).toBe(task.id);
    expect(item1.description).toBe("Brush teeth");
    expect(item1.sort_order).toBe(0);
    expect(item1.completed).toBe(0);
    expect(item2.sort_order).toBe(1);
  });

  it("lists items sorted by sort_order", () => {
    const task = taskService.create({ title: "Task", frequency: "daily", createdBy: userId });
    taskService.addItem(task.id, "Second", 2);
    taskService.addItem(task.id, "First", 1);

    const items = taskService.listItems(task.id);
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe("First");
    expect(items[1].description).toBe("Second");
  });

  it("toggles item completion", () => {
    const task = taskService.create({ title: "Task", frequency: "daily", createdBy: userId });
    const item = taskService.addItem(task.id, "Item");

    const toggled = taskService.toggleItemCompletion(item.id);
    expect(toggled?.completed).toBe(1);

    const toggled2 = taskService.toggleItemCompletion(item.id);
    expect(toggled2?.completed).toBe(0);
  });

  it("updates item description", () => {
    const task = taskService.create({ title: "Task", frequency: "daily", createdBy: userId });
    const item = taskService.addItem(task.id, "Old desc");

    const updated = taskService.updateItem(item.id, { description: "New desc" });
    expect(updated?.description).toBe("New desc");
  });

  it("deletes an item", () => {
    const task = taskService.create({ title: "Task", frequency: "daily", createdBy: userId });
    const item = taskService.addItem(task.id, "Delete me");

    expect(taskService.deleteItem(item.id)).toBe(true);
    expect(taskService.listItems(task.id)).toHaveLength(0);
  });

  it("cascades item deletion when task is deleted", () => {
    const task = taskService.create({ title: "Task", frequency: "daily", createdBy: userId });
    taskService.addItem(task.id, "Item 1");
    taskService.addItem(task.id, "Item 2");

    taskService.delete(task.id, userId);
    const items = db.prepare("SELECT * FROM personal_task_items WHERE task_id = ?").all(task.id);
    expect(items).toHaveLength(0);
  });

  it("archives a task", () => {
    const task = taskService.create({ title: "Archive me", frequency: "daily", createdBy: userId });
    const archived = taskService.archiveTask(task.id, userId);
    expect(archived?.active).toBe(0);

    // Archived tasks don't appear in active list
    const tasks = taskService.list(userId);
    expect(tasks.find(t => t.id === task.id)).toBeUndefined();
  });
});

// ===================== REMINDER ALERTS =====================

describe("ReminderService - Alerts", () => {
  it("creates alerts for a reminder", () => {
    const r = reminderService.create({
      title: "Meeting",
      event_date: "2026-03-15T10:00:00",
      alerts: [
        { offset_value: 1, offset_unit: "hours" },
        { offset_value: 1, offset_unit: "days" }
      ],
      createdBy: userId
    });

    const alerts = reminderService.listAlerts(r.id);
    expect(alerts).toHaveLength(2);
    expect(alerts.some(a => a.offset_unit === "hours" && a.offset_value === 1)).toBe(true);
    expect(alerts.some(a => a.offset_unit === "days" && a.offset_value === 1)).toBe(true);
  });

  it("enforces max 5 alerts", () => {
    const r = reminderService.create({
      title: "Many alerts",
      event_date: "2026-03-15T10:00:00",
      alerts: [
        { offset_value: 1, offset_unit: "hours" },
        { offset_value: 2, offset_unit: "hours" },
        { offset_value: 3, offset_unit: "hours" },
        { offset_value: 4, offset_unit: "hours" },
        { offset_value: 5, offset_unit: "hours" },
      ],
      createdBy: userId
    });

    expect(reminderService.listAlerts(r.id)).toHaveLength(5);
    expect(() => reminderService.createAlert(r.id, 6, "hours")).toThrow("Maximum of 5 alerts");
  });

  it("deletes an alert", () => {
    const r = reminderService.create({
      title: "Del alert",
      event_date: "2026-03-15T10:00:00",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    const alerts = reminderService.listAlerts(r.id);
    expect(reminderService.deleteAlert(alerts[0].id)).toBe(true);
    expect(reminderService.listAlerts(r.id)).toHaveLength(0);
  });

  it("cascades alert deletion when reminder is deleted", () => {
    const r = reminderService.create({
      title: "Cascade",
      event_date: "2026-03-15T10:00:00",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    reminderService.delete(r.id, userId);
    const alerts = db.prepare("SELECT * FROM reminder_alerts WHERE reminder_id = ?").all(r.id);
    expect(alerts).toHaveLength(0);
  });

  it("replaces alerts on update", () => {
    const r = reminderService.create({
      title: "Replace alerts",
      event_date: "2026-03-15T10:00:00",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    reminderService.update(r.id, {
      alerts: [
        { offset_value: 2, offset_unit: "days" },
        { offset_value: 30, offset_unit: "hours" }
      ]
    }, userId);

    const alerts = reminderService.listAlerts(r.id);
    expect(alerts).toHaveLength(2);
    expect(alerts.every(a => a.offset_value !== 1)).toBe(true);
  });

  it("getDueAlerts finds alerts that should fire", () => {
    // Create a reminder with event in the past and an alert 1 hour before
    const r = reminderService.create({
      title: "Past with alert",
      event_date: "2020-01-01T10:00:00",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    const due = reminderService.getDueAlerts();
    expect(due.some(d => d.reminder.id === r.id)).toBe(true);
  });

  it("marks alert as sent", () => {
    const r = reminderService.create({
      title: "Mark sent",
      event_date: "2020-01-01T10:00:00",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    const alerts = reminderService.listAlerts(r.id);
    reminderService.markAlertSent(alerts[0].id);

    const updated = reminderService.listAlerts(r.id);
    expect(updated[0].sent).toBe(1);

    // Should no longer be in due list
    const due = reminderService.getDueAlerts();
    expect(due.some(d => d.alert.id === alerts[0].id)).toBe(false);
  });
});

// ===================== RECURRENCE =====================

describe("ReminderService - Recurrence", () => {
  it("creates a recurring reminder", () => {
    const r = reminderService.create({
      title: "Weekly standup",
      event_date: "2026-03-15T10:00:00",
      recurrence: "weekly",
      createdBy: userId
    });

    expect(r.recurrence).toBe("weekly");
    expect(r.next_event_date).toBe("2026-03-15T10:00:00");
  });

  it("advances weekly recurrence", () => {
    const r = reminderService.create({
      title: "Weekly",
      event_date: "2026-03-15T10:00:00",
      recurrence: "weekly",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    // Mark alert as sent
    const alerts = reminderService.listAlerts(r.id);
    reminderService.markAlertSent(alerts[0].id);

    const advanced = reminderService.advanceRecurrence(r.id);
    expect(advanced).not.toBeNull();
    // Should be 7 days later
    expect(advanced!.event_date).toContain("2026-03-22");
    expect(advanced!.sent_event).toBe(0);

    // Alerts should be reset
    const newAlerts = reminderService.listAlerts(r.id);
    expect(newAlerts[0].sent).toBe(0);
  });

  it("advances monthly recurrence", () => {
    const r = reminderService.create({
      title: "Monthly",
      event_date: "2026-03-15T10:00:00",
      recurrence: "monthly",
      createdBy: userId
    });

    const advanced = reminderService.advanceRecurrence(r.id);
    expect(advanced!.event_date).toContain("2026-04-15");
  });

  it("advances yearly recurrence", () => {
    const r = reminderService.create({
      title: "Yearly",
      event_date: "2026-03-15T10:00:00",
      recurrence: "yearly",
      createdBy: userId
    });

    const advanced = reminderService.advanceRecurrence(r.id);
    expect(advanced!.event_date).toContain("2027-03-15");
  });

  it("returns null for non-recurring reminder", () => {
    const r = reminderService.create({
      title: "One-time",
      event_date: "2026-03-15T10:00:00",
      createdBy: userId
    });

    const result = reminderService.advanceRecurrence(r.id);
    expect(result).toBeNull();
  });

  it("getByIdWithAlerts returns reminder with alerts", () => {
    const r = reminderService.create({
      title: "With alerts",
      event_date: "2026-03-15T10:00:00",
      alerts: [
        { offset_value: 1, offset_unit: "hours" },
        { offset_value: 2, offset_unit: "days" }
      ],
      createdBy: userId
    });

    const full = reminderService.getByIdWithAlerts(r.id);
    expect(full).not.toBeNull();
    expect(full!.alerts).toHaveLength(2);
    expect(full!.title).toBe("With alerts");
  });
});

// ===================== BITMASK DAY FILTERING =====================

describe("PersonalTaskService - Bitmask Day Filtering", () => {
  it("generates daily instances only for matching bitmask days", () => {
    // MWF = bit1 + bit3 + bit5 = 2 + 8 + 32 = 42
    taskService.create({ title: "MWF task", frequency: "daily", day_of_week: 42, createdBy: userId });
    // Tue/Thu = bit2 + bit4 = 4 + 16 = 20
    taskService.create({ title: "TTh task", frequency: "daily", day_of_week: 20, createdBy: userId });

    // Monday 2026-03-16 (day 1) — should generate MWF only
    const mondayCount = taskService.generateDailyInstances(userId, "2026-03-16");
    expect(mondayCount).toBe(1);

    // Tuesday 2026-03-17 (day 2) — should generate TTh only
    const tuesdayCount = taskService.generateDailyInstances(userId, "2026-03-17");
    expect(tuesdayCount).toBe(1);
  });

  it("bitmask 127 generates instance on all days", () => {
    taskService.create({ title: "Every day", frequency: "daily", day_of_week: 127, createdBy: userId });

    // Generate for 7 consecutive days starting 2026-03-15 (Sunday=0)
    for (let i = 0; i < 7; i++) {
      const date = `2026-03-${String(15 + i).padStart(2, "0")}`;
      const count = taskService.generateDailyInstances(userId, date);
      expect(count).toBe(1);
    }
  });

  it("bitmask 0 generates instance on no day", () => {
    taskService.create({ title: "No days", frequency: "daily", day_of_week: 0, createdBy: userId });

    for (let i = 0; i < 7; i++) {
      const date = `2026-03-${String(15 + i).padStart(2, "0")}`;
      const count = taskService.generateDailyInstances(userId, date);
      expect(count).toBe(0);
    }
  });
});

// ===================== AUTO-ARCHIVE =====================

describe("PersonalTaskService - Auto Archive", () => {
  it("archives once-off task completed more than 48h ago", () => {
    const task = taskService.create({ title: "Old once-off", frequency: "once", createdBy: userId });
    const today = new Date().toISOString().slice(0, 10);
    taskService.toggleCompletion(task.id, today);

    // Manually set completed_at to 49 hours ago
    const past = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE personal_tasks SET completed_at = ? WHERE id = ?").run(past, task.id);

    const eligible = taskService.getArchiveEligible();
    expect(eligible.some(t => t.id === task.id)).toBe(true);

    const count = taskService.autoArchive();
    expect(count).toBeGreaterThanOrEqual(1);

    // Should now be inactive
    const updated = taskService.getById(task.id);
    expect(updated?.active).toBe(0);
  });

  it("archives daily instance completed more than 48h ago", () => {
    // Create a daily template first, then generate an instance
    taskService.create({ title: "Daily template", frequency: "daily", createdBy: userId });
    const today = new Date().toISOString().slice(0, 10);
    taskService.generateDailyInstances(userId, today);

    // Find the generated instance
    const instances = db.prepare("SELECT * FROM personal_tasks WHERE frequency = 'once' AND template_id IS NOT NULL AND created_by = ?").all(userId) as { id: number }[];
    expect(instances.length).toBeGreaterThanOrEqual(1);
    const instance = instances[0];

    taskService.toggleCompletion(instance.id, today);

    // Manually set completed_at to 49 hours ago
    const past = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE personal_tasks SET completed_at = ? WHERE id = ?").run(past, instance.id);

    const eligible = taskService.getArchiveEligible();
    expect(eligible.some(t => t.id === instance.id)).toBe(true);

    taskService.autoArchive();
    expect(taskService.getById(instance.id)?.active).toBe(0);
  });

  it("does NOT archive daily task completed less than 24h ago", () => {
    const task = taskService.create({ title: "Recent daily", frequency: "daily", createdBy: userId });
    const today = new Date().toISOString().slice(0, 10);
    taskService.toggleCompletion(task.id, today);

    // completed_at is set to now by toggleCompletion, which is < 24h
    const eligible = taskService.getArchiveEligible();
    expect(eligible.some(t => t.id === task.id)).toBe(false);
  });

  it("toggleCompletion sets and clears completed_at", () => {
    const task = taskService.create({ title: "Track", frequency: "daily", createdBy: userId });
    const today = new Date().toISOString().slice(0, 10);

    // Complete: sets completed_at
    taskService.toggleCompletion(task.id, today);
    const after = taskService.getById(task.id);
    expect(after?.completed_at).not.toBeNull();

    // Uncomplete: clears completed_at
    taskService.toggleCompletion(task.id, today);
    const after2 = taskService.getById(task.id);
    expect(after2?.completed_at).toBeNull();
  });
});

// ===================== REMINDER AUTO-ARCHIVE =====================

describe("ReminderService - Auto Archive", () => {
  it("auto-archives reminder 3h after event when sent_event=1", () => {
    const r = reminderService.create({
      title: "Past reminder",
      event_date: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 19),
      createdBy: userId
    });

    // Mark event as sent
    reminderService.markSent(r.id, "event");

    const count = reminderService.autoArchiveReminders();
    expect(count).toBeGreaterThanOrEqual(1);

    const updated = reminderService.getById(r.id);
    expect(updated?.active).toBe(0);
  });

  it("does NOT auto-archive reminder when event < 3h ago", () => {
    const r = reminderService.create({
      title: "Recent reminder",
      event_date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString().slice(0, 19),
      createdBy: userId
    });

    reminderService.markSent(r.id, "event");

    const count = reminderService.autoArchiveReminders();
    // This one should NOT be archived (only 1h ago)
    const updated = reminderService.getById(r.id);
    expect(updated?.active).toBe(1);
  });

  it("listForTasksView returns reminders with passed event_date", () => {
    const pastReminder = reminderService.create({
      title: "Past event",
      event_date: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString().slice(0, 19),
      createdBy: userId
    });

    const futureReminder = reminderService.create({
      title: "Future event",
      event_date: "2099-01-01T10:00:00",
      createdBy: userId
    });

    const tasksView = reminderService.listForTasksView(userId);
    expect(tasksView.some(r => r.id === pastReminder.id)).toBe(true);
    expect(tasksView.some(r => r.id === futureReminder.id)).toBe(false);
  });

  it("listForTasksView returns reminders with sent alerts", () => {
    const r = reminderService.create({
      title: "Future with sent alert",
      event_date: "2099-01-01T10:00:00",
      alerts: [{ offset_value: 1, offset_unit: "hours" }],
      createdBy: userId
    });

    // Before sending alert - should not appear
    let tasksView = reminderService.listForTasksView(userId);
    expect(tasksView.some(rv => rv.id === r.id)).toBe(false);

    // After sending alert - should appear
    const alerts = reminderService.listAlerts(r.id);
    reminderService.markAlertSent(alerts[0].id);

    tasksView = reminderService.listForTasksView(userId);
    expect(tasksView.some(rv => rv.id === r.id)).toBe(true);
  });
});

// ===================== INACTIVE TASKS LISTING =====================

describe("PersonalTaskService - Inactive listing", () => {
  it("listInactive returns archived tasks", () => {
    const task = taskService.create({ title: "Archived", frequency: "daily", createdBy: userId });
    taskService.archiveTask(task.id, userId);

    const inactive = taskService.listInactive(userId);
    expect(inactive).toHaveLength(1);
    expect(inactive[0].title).toBe("Archived");
  });

  it("listInactive filters by frequency", () => {
    const daily = taskService.create({ title: "Daily", frequency: "daily", createdBy: userId });
    const weekly = taskService.create({ title: "Weekly", frequency: "weekly", createdBy: userId });
    taskService.archiveTask(daily.id, userId);
    taskService.archiveTask(weekly.id, userId);

    const dailyInactive = taskService.listInactive(userId, "daily");
    expect(dailyInactive).toHaveLength(1);
    expect(dailyInactive[0].title).toBe("Daily");
  });
});

// ===================== FULL WORKFLOW =====================

describe("Tasks + Reminders workflow", () => {
  it("daily tasks track per-day completions independently", () => {
    const task = taskService.create({ title: "Exercise", frequency: "daily", createdBy: userId });

    taskService.toggleCompletion(task.id, "2026-03-08");
    taskService.toggleCompletion(task.id, "2026-03-09");

    const completions = taskService.getCompletions(task.id, "2026-03-01", "2026-03-31");
    expect(completions).toHaveLength(2);

    // Toggle off one day
    taskService.toggleCompletion(task.id, "2026-03-08");
    const completions2 = taskService.getCompletions(task.id, "2026-03-01", "2026-03-31");
    expect(completions2).toHaveLength(1);
    expect(completions2[0].completed_date).toBe("2026-03-09");
  });
});
