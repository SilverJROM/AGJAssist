import { DatabaseService } from "../db/database.js";

export interface AgentSolicitReminder {
  id: number;
  user_id: number;
  folder_group: string;
  cadence_minutes: number;
  repeat_limit: number | null;
  repeat_count: number;
  next_fire: string | null;
  solicit_message: string;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface AgentSolicitRecipient {
  id: number;
  reminder_id: number;
  agent_name: string;
  include: number;
  created_at: string;
}

export interface AgentSolicitReminderWithRecipients extends AgentSolicitReminder {
  recipients: AgentSolicitRecipient[];
}

export class AgentSolicitService {
  constructor(private readonly db: DatabaseService) {}

  create(params: {
    user_id: number;
    folder_group: string;
    cadence_minutes: number;
    repeat_limit?: number | null;
    solicit_message?: string;
    next_fire?: string | null;
    recipients?: { agent_name: string; include?: number }[];
    active?: number;
  }): AgentSolicitReminderWithRecipients {
    if (params.cadence_minutes <= 0) {
      throw new Error("cadence_minutes must be > 0");
    }

    const solicitMessage = params.solicit_message ?? "give me a status update";
    const repeatLimit = params.repeat_limit ?? null;
    // An active reminder must have a scheduled next_fire or it is never "due"
    // (getDueReminders requires next_fire IS NOT NULL). Default to one cadence
    // period from now so it fires on schedule without an explicit next_fire.
    const nextFire = params.next_fire ?? new Date(Date.now() + params.cadence_minutes * 60 * 1000).toISOString();
    const active = params.active ?? 1;

    const reminder = this.db
      .prepare(
        `INSERT INTO agent_solicit_reminders
         (user_id, folder_group, cadence_minutes, repeat_limit, repeat_count, next_fire, solicit_message, active)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)
         RETURNING *`
      )
      .get(
        params.user_id,
        params.folder_group,
        params.cadence_minutes,
        repeatLimit,
        nextFire,
        solicitMessage,
        active
      ) as AgentSolicitReminder;

    if (params.recipients && params.recipients.length > 0) {
      for (const r of params.recipients) {
        this.db
          .prepare(
            `INSERT INTO agent_solicit_recipients (reminder_id, agent_name, include)
             VALUES (?, ?, ?)`
          )
          .run(reminder.id, r.agent_name, r.include ?? 1);
      }
    }

    return {
      ...reminder,
      recipients: this.listRecipients(reminder.id),
    };
  }

  list(userId: number): AgentSolicitReminderWithRecipients[] {
    const reminders = this.db
      .prepare(
        `SELECT * FROM agent_solicit_reminders WHERE user_id = ? ORDER BY id`
      )
      .all(userId) as AgentSolicitReminder[];

    return reminders.map((r) => ({
      ...r,
      recipients: this.listRecipients(r.id),
    }));
  }

  listActive(userId: number): AgentSolicitReminderWithRecipients[] {
    const reminders = this.db
      .prepare(
        `SELECT * FROM agent_solicit_reminders WHERE user_id = ? AND active = 1 ORDER BY id`
      )
      .all(userId) as AgentSolicitReminder[];

    return reminders.map((r) => ({
      ...r,
      recipients: this.listRecipients(r.id),
    }));
  }

  getById(id: number): AgentSolicitReminderWithRecipients | null {
    const reminder = this.db
      .prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`)
      .get(id) as AgentSolicitReminder | null;
    if (!reminder) return null;
    return {
      ...reminder,
      recipients: this.listRecipients(id),
    };
  }

  update(
    id: number,
    updates: {
      folder_group?: string;
      cadence_minutes?: number;
      repeat_limit?: number | null;
      next_fire?: string | null;
      solicit_message?: string;
      active?: number;
      recipients?: { agent_name: string; include?: number }[];
    }
  ): AgentSolicitReminderWithRecipients | null {
    const existing = this.db
      .prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`)
      .get(id) as AgentSolicitReminder | null;
    if (!existing) return null;

    if (updates.cadence_minutes !== undefined && updates.cadence_minutes <= 0) {
      throw new Error("cadence_minutes must be > 0");
    }

    const folderGroup = updates.folder_group ?? existing.folder_group;
    const cadenceMinutes = updates.cadence_minutes ?? existing.cadence_minutes;
    const repeatLimit = updates.repeat_limit !== undefined ? updates.repeat_limit : existing.repeat_limit;
    // Re-arm the schedule when neither the update nor the existing row carries a
    // next_fire (e.g. a legacy reminder created before next_fire was defaulted),
    // so editing a stuck reminder makes it fire again.
    const nextFire = updates.next_fire !== undefined
      ? updates.next_fire
      : (existing.next_fire ?? new Date(Date.now() + cadenceMinutes * 60 * 1000).toISOString());
    const solicitMessage = updates.solicit_message ?? existing.solicit_message;
    const active = updates.active ?? existing.active;

    this.db
      .prepare(
        `UPDATE agent_solicit_reminders
         SET folder_group = ?, cadence_minutes = ?, repeat_limit = ?, next_fire = ?, solicit_message = ?, active = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(folderGroup, cadenceMinutes, repeatLimit, nextFire, solicitMessage, active, id);

    if (updates.recipients !== undefined) {
      this.db.prepare(`DELETE FROM agent_solicit_recipients WHERE reminder_id = ?`).run(id);
      for (const r of updates.recipients) {
        this.db
          .prepare(
            `INSERT INTO agent_solicit_recipients (reminder_id, agent_name, include)
             VALUES (?, ?, ?)`
          )
          .run(id, r.agent_name, r.include ?? 1);
      }
    }

    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare(`DELETE FROM agent_solicit_reminders WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  listRecipients(reminderId: number): AgentSolicitRecipient[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_solicit_recipients WHERE reminder_id = ? ORDER BY id`
      )
      .all(reminderId) as AgentSolicitRecipient[];
  }

  getDueReminders(): AgentSolicitReminderWithRecipients[] {
    const reminders = this.db
      .prepare(
        `SELECT * FROM agent_solicit_reminders
         WHERE active = 1 AND next_fire IS NOT NULL
         AND datetime(next_fire) <= datetime('now')
         AND (repeat_limit IS NULL OR repeat_count < repeat_limit)`
      )
      .all() as AgentSolicitReminder[];

    return reminders.map((r) => ({
      ...r,
      recipients: this.listRecipients(r.id),
    }));
  }

  advanceReminder(id: number): AgentSolicitReminder | null {
    const reminder = this.db
      .prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`)
      .get(id) as AgentSolicitReminder | null;
    if (!reminder || !reminder.next_fire) return null;

    const nextFireDate = new Date(reminder.next_fire);
    const next = new Date(nextFireDate.getTime() + reminder.cadence_minutes * 60 * 1000);
    const nextFireIso = next.toISOString();

    const newRepeatCount = reminder.repeat_count + 1;
    this.db
      .prepare(
        `UPDATE agent_solicit_reminders
         SET repeat_count = ?, next_fire = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(newRepeatCount, nextFireIso, id);

    // Deactivate if repeat limit reached
    if (reminder.repeat_limit !== null && newRepeatCount >= reminder.repeat_limit) {
      this.db
        .prepare(`UPDATE agent_solicit_reminders SET active = 0, updated_at = datetime('now') WHERE id = ?`)
        .run(id);
    }

    return this.db.prepare(`SELECT * FROM agent_solicit_reminders WHERE id = ?`).get(id) as AgentSolicitReminder;
  }
}
