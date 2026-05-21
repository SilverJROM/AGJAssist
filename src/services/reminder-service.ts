import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface Reminder {
  id: number;
  title: string;
  description: string | null;
  event_date: string; // ISO datetime
  reminder_1: string | null; // ISO datetime for first reminder (legacy)
  reminder_2: string | null; // ISO datetime for second reminder (legacy)
  sent_1: number;
  sent_2: number;
  sent_event: number;
  recurrence: string | null; // 'weekly' | 'monthly' | 'yearly' | null
  next_event_date: string | null;
  active: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface ReminderAlert {
  id: number;
  reminder_id: number;
  offset_value: number;
  offset_unit: string; // 'hours' | 'days'
  sent: number;
  created_at: string;
}

export interface ReminderWithAlerts extends Reminder {
  alerts: ReminderAlert[];
}

export class ReminderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  list(userId: number): Reminder[] {
    return this.db
      .prepare(
        "SELECT * FROM reminders WHERE created_by = ? AND active = 1 ORDER BY event_date"
      )
      .all(userId) as Reminder[];
  }

  listAll(userId: number): Reminder[] {
    return this.db
      .prepare(
        "SELECT * FROM reminders WHERE created_by = ? ORDER BY event_date"
      )
      .all(userId) as Reminder[];
  }

  listWithAlerts(userId: number): ReminderWithAlerts[] {
    const reminders = this.list(userId);
    return reminders.map((r) => ({
      ...r,
      alerts: this.listAlerts(r.id),
    }));
  }

  listAllWithAlerts(userId: number): ReminderWithAlerts[] {
    const reminders = this.listAll(userId);
    return reminders.map((r) => ({
      ...r,
      alerts: this.listAlerts(r.id),
    }));
  }

  getById(id: number): Reminder | null {
    return (
      (this.db
        .prepare("SELECT * FROM reminders WHERE id = ?")
        .get(id) as Reminder | null) ?? null
    );
  }

  getByIdWithAlerts(id: number): ReminderWithAlerts | null {
    const reminder = this.getById(id);
    if (!reminder) return null;
    return { ...reminder, alerts: this.listAlerts(id) };
  }

  create(params: {
    title: string;
    description?: string | null;
    event_date: string;
    reminder_1?: string | null;
    reminder_2?: string | null;
    recurrence?: string | null;
    alerts?: { offset_value: number; offset_unit: string }[];
    createdBy: number;
  }): Reminder {
    const result = this.db
      .prepare(
        "INSERT INTO reminders (title, description, event_date, reminder_1, reminder_2, recurrence, next_event_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
      )
      .get(
        params.title,
        params.description ?? null,
        params.event_date,
        params.reminder_1 ?? null,
        params.reminder_2 ?? null,
        params.recurrence ?? null,
        params.recurrence ? params.event_date : null,
        params.createdBy
      ) as Reminder;

    // Create alerts if provided
    if (params.alerts && params.alerts.length > 0) {
      for (const alert of params.alerts.slice(0, 5)) {
        this.createAlert(result.id, alert.offset_value, alert.offset_unit);
      }
    }

    this.auditService.log({
      userId: params.createdBy,
      actionType: "reminder_create",
      resourceType: "reminder",
      resourceId: String(result.id),
      details: { title: params.title, event_date: params.event_date },
    });

    return result;
  }

  update(
    id: number,
    updates: {
      title?: string;
      description?: string | null;
      event_date?: string;
      reminder_1?: string | null;
      reminder_2?: string | null;
      recurrence?: string | null;
      active?: number;
      alerts?: { offset_value: number; offset_unit: string }[];
    },
    userId: number
  ): Reminder | null {
    const existing = this.db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(id) as Reminder | null;
    if (!existing) return null;

    const title = updates.title ?? existing.title;
    const description =
      updates.description !== undefined
        ? updates.description
        : existing.description;
    const event_date = updates.event_date ?? existing.event_date;
    const reminder_1 =
      updates.reminder_1 !== undefined
        ? updates.reminder_1
        : existing.reminder_1;
    const reminder_2 =
      updates.reminder_2 !== undefined
        ? updates.reminder_2
        : existing.reminder_2;
    const recurrence =
      updates.recurrence !== undefined
        ? updates.recurrence
        : existing.recurrence;
    const active =
      updates.active !== undefined ? updates.active : existing.active;

    this.db
      .prepare(
        "UPDATE reminders SET title = ?, description = ?, event_date = ?, reminder_1 = ?, reminder_2 = ?, recurrence = ?, active = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(title, description, event_date, reminder_1, reminder_2, recurrence, active, id);

    // Replace alerts if provided
    if (updates.alerts !== undefined) {
      this.db.prepare("DELETE FROM reminder_alerts WHERE reminder_id = ?").run(id);
      for (const alert of updates.alerts.slice(0, 5)) {
        this.createAlert(id, alert.offset_value, alert.offset_unit);
      }
    }

    this.auditService.log({
      userId,
      actionType: "reminder_update",
      resourceType: "reminder",
      resourceId: String(id),
      details: updates,
    });

    return this.db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(id) as Reminder;
  }

  delete(id: number, userId: number): boolean {
    const existing = this.db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(id) as Reminder | null;
    if (!existing) return false;

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM reminder_alerts WHERE reminder_id = ?").run(id);
      this.db.prepare("DELETE FROM reminders WHERE id = ?").run(id);
    });

    this.auditService.log({
      userId,
      actionType: "reminder_delete",
      resourceType: "reminder",
      resourceId: String(id),
      details: { title: existing.title },
    });

    return true;
  }

  // ===================== ALERTS =====================

  listAlerts(reminderId: number): ReminderAlert[] {
    return this.db
      .prepare(
        "SELECT * FROM reminder_alerts WHERE reminder_id = ? ORDER BY offset_value, offset_unit"
      )
      .all(reminderId) as ReminderAlert[];
  }

  createAlert(
    reminderId: number,
    offsetValue: number,
    offsetUnit: string
  ): ReminderAlert {
    // Enforce max 5 alerts per reminder
    const count = (this.db
      .prepare("SELECT COUNT(*) as cnt FROM reminder_alerts WHERE reminder_id = ?")
      .get(reminderId) as { cnt: number }).cnt;

    if (count >= 5) {
      throw new Error("Maximum of 5 alerts per reminder");
    }

    return this.db
      .prepare(
        "INSERT INTO reminder_alerts (reminder_id, offset_value, offset_unit) VALUES (?, ?, ?) RETURNING *"
      )
      .get(reminderId, offsetValue, offsetUnit) as ReminderAlert;
  }

  deleteAlert(alertId: number): boolean {
    const result = this.db
      .prepare("DELETE FROM reminder_alerts WHERE id = ?")
      .run(alertId);
    return result.changes > 0;
  }

  markAlertSent(alertId: number): void {
    this.db
      .prepare("UPDATE reminder_alerts SET sent = 1 WHERE id = ?")
      .run(alertId);
  }

  // ===================== TASKS VIEW & AUTO-ARCHIVE =====================

  listForTasksView(userId: number): ReminderWithAlerts[] {
    const now = new Date().toISOString();
    const reminders = this.db
      .prepare(
        "SELECT * FROM reminders WHERE created_by = ? AND active = 1 ORDER BY event_date"
      )
      .all(userId) as Reminder[];

    return reminders
      .filter(r => {
        // Include if event_date <= now
        if (r.event_date <= now) return true;
        // Include if any alert has been sent
        const alerts = this.listAlerts(r.id);
        return alerts.some(a => a.sent === 1);
      })
      .map(r => ({ ...r, alerts: this.listAlerts(r.id) }));
  }

  autoArchiveReminders(): number {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(
      "UPDATE reminders SET active = 0, updated_at = datetime('now') WHERE active = 1 AND sent_event = 1 AND event_date < ?"
    ).run(threeHoursAgo);
    return result.changes;
  }

  // ===================== DUE REMINDERS (new alert-based system) =====================

  /** Parse a stored datetime as Manila time (stored without timezone = assumed Manila) */
  private static parseAsManila(dateStr: string): Date {
    // If already has timezone info, parse as-is
    if (dateStr.includes("+") || dateStr.endsWith("Z")) {
      return new Date(dateStr);
    }
    // Treat naive datetime as Asia/Manila (+08:00)
    return new Date(dateStr + "+08:00");
  }

  /** Get current time in Manila */
  private static nowManila(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  }

  getDueAlerts(): { reminder: Reminder; alert: ReminderAlert; type: "alert" }[] {
    const now = new Date();
    const results: { reminder: Reminder; alert: ReminderAlert; type: "alert" }[] = [];

    const reminders = this.db
      .prepare("SELECT * FROM reminders WHERE active = 1")
      .all() as Reminder[];

    for (const reminder of reminders) {
      const alerts = this.listAlerts(reminder.id);
      const eventTime = ReminderService.parseAsManila(reminder.event_date).getTime();

      for (const alert of alerts) {
        if (alert.sent) continue;

        const offsetMs = alert.offset_unit === "days"
          ? alert.offset_value * 24 * 60 * 60 * 1000
          : alert.offset_value * 60 * 60 * 1000;

        const fireTime = eventTime - offsetMs;
        if (now.getTime() >= fireTime) {
          results.push({ reminder, alert, type: "alert" });
        }
      }
    }

    return results;
  }

  // Legacy: still supports old reminder_1/reminder_2 columns
  getDueReminders(): { reminder: Reminder; type: "reminder_1" | "reminder_2" | "event" }[] {
    const now = new Date();
    const results: { reminder: Reminder; type: "reminder_1" | "reminder_2" | "event" }[] = [];

    const reminders = this.db
      .prepare(
        "SELECT * FROM reminders WHERE active = 1 AND (sent_event = 0 OR sent_1 = 0 OR sent_2 = 0)"
      )
      .all() as Reminder[];

    for (const reminder of reminders) {
      if (reminder.reminder_1 && reminder.sent_1 === 0 && ReminderService.parseAsManila(reminder.reminder_1).getTime() <= now.getTime()) {
        results.push({ reminder, type: "reminder_1" });
      }
      if (reminder.reminder_2 && reminder.sent_2 === 0 && ReminderService.parseAsManila(reminder.reminder_2).getTime() <= now.getTime()) {
        results.push({ reminder, type: "reminder_2" });
      }
      if (reminder.sent_event === 0 && ReminderService.parseAsManila(reminder.event_date).getTime() <= now.getTime()) {
        results.push({ reminder, type: "event" });
      }
    }

    return results;
  }

  markSent(id: number, type: "reminder_1" | "reminder_2" | "event"): void {
    const column =
      type === "reminder_1"
        ? "sent_1"
        : type === "reminder_2"
          ? "sent_2"
          : "sent_event";

    this.db
      .prepare(`UPDATE reminders SET ${column} = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  // ===================== RECURRENCE =====================

  advanceRecurrence(reminderId: number): Reminder | null {
    const reminder = this.getById(reminderId);
    if (!reminder || !reminder.recurrence) return null;

    const eventDate = ReminderService.parseAsManila(reminder.event_date);
    let nextDate: Date;

    switch (reminder.recurrence) {
      case "weekly":
        nextDate = new Date(eventDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        nextDate = new Date(eventDate);
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case "yearly":
        nextDate = new Date(eventDate);
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
      default:
        return null;
    }

    // Store as naive Manila datetime (same format as input)
    const pad = (n: number) => String(n).padStart(2, "0");
    // Convert nextDate (UTC) back to Manila for storage
    const manilaNext = new Date(nextDate.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const nextEventDate = `${manilaNext.getFullYear()}-${pad(manilaNext.getMonth() + 1)}-${pad(manilaNext.getDate())}T${pad(manilaNext.getHours())}:${pad(manilaNext.getMinutes())}:${pad(manilaNext.getSeconds())}`;

    // Update the event date and reset sent flags
    this.db.prepare(
      "UPDATE reminders SET event_date = ?, next_event_date = ?, sent_event = 0, sent_1 = 0, sent_2 = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(nextEventDate, nextEventDate, reminderId);

    // Reset all alert sent flags
    this.db.prepare(
      "UPDATE reminder_alerts SET sent = 0 WHERE reminder_id = ?"
    ).run(reminderId);

    return this.getById(reminderId);
  }
}
