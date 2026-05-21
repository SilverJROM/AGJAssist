import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface PersonalTask {
  id: number;
  title: string;
  description: string | null;
  frequency: string; // 'once' | 'daily' | 'weekly'
  day_of_week: number | null; // bitmask 0-127 for daily tasks (bit0=Sun..bit6=Sat)
  due_date: string | null; // for 'once' tasks
  active: number;
  completed_at: string | null; // timestamp of last completion for auto-archive
  template_id: number | null; // NULL for templates & one-offs, references parent template for instances
  target_date: string | null; // YYYY-MM-DD date this instance targets
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface PersonalTaskItem {
  id: number;
  task_id: number;
  description: string;
  sort_order: number;
  completed: number;
  created_at: string;
}

export interface PersonalTaskWithStatus extends PersonalTask {
  completed_today: boolean; // for daily
  completed_this_week: boolean; // for weekly
  completed: boolean; // for once
}

function getMondayOfWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getSundayOfWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function getTodayManila(): string {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })).toISOString().slice(0, 10);
}

function getSaturdayOfWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 6 ? 0 : 6 - day; // Saturday = 6
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export class PersonalTaskService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  list(userId: number, frequency?: string): PersonalTaskWithStatus[] {
    let sql = "SELECT * FROM personal_tasks WHERE created_by = ? AND active = 1";
    const params: unknown[] = [userId];

    if (frequency) {
      sql += " AND frequency = ?";
      params.push(frequency);
    }

    sql += " ORDER BY created_at DESC";
    const tasks = this.db.prepare(sql).all(...params) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** List only templates (for Setup tab): daily/weekly tasks with no template_id */
  listTemplates(userId: number, frequency?: string): PersonalTaskWithStatus[] {
    let sql = "SELECT * FROM personal_tasks WHERE created_by = ? AND template_id IS NULL AND frequency IN ('daily', 'weekly')";
    const params: unknown[] = [userId];

    if (frequency) {
      sql += " AND frequency = ?";
      params.push(frequency);
    }

    sql += " ORDER BY created_at DESC";
    const tasks = this.db.prepare(sql).all(...params) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** List instances: today's + past incomplete (not yet completed) */
  listInstances(userId: number, targetDate: string): PersonalTaskWithStatus[] {
    const sql = `SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND frequency = 'once'
      AND (target_date = ? OR (target_date < ? AND completed_at IS NULL))
      ORDER BY target_date DESC, created_at DESC`;
    const tasks = this.db.prepare(sql).all(userId, targetDate, targetDate) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** List daily instances: today's + past incomplete */
  listDailyInstances(userId: number, targetDate: string): PersonalTaskWithStatus[] {
    const sql = `SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND completed_at IS NULL
      AND (target_date = ? OR target_date < ?)
      AND template_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM personal_tasks t WHERE t.id = personal_tasks.template_id AND t.frequency = 'daily')
      ORDER BY target_date DESC, created_at DESC`;
    const tasks = this.db.prepare(sql).all(userId, targetDate, targetDate) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** List weekly instances: this week's + past incomplete */
  listWeeklyInstances(userId: number, saturdayDate: string): PersonalTaskWithStatus[] {
    const sql = `SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND completed_at IS NULL
      AND (target_date = ? OR target_date < ?)
      AND template_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM personal_tasks t WHERE t.id = personal_tasks.template_id AND t.frequency = 'weekly')
      ORDER BY target_date DESC, created_at DESC`;
    const tasks = this.db.prepare(sql).all(userId, saturdayDate, saturdayDate) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** List one-off tasks: today's + past incomplete.
   *  Excludes generated instances (whose template_id points to a daily/weekly template). */
  listOneOffs(userId: number, targetDate: string): PersonalTaskWithStatus[] {
    const sql = `SELECT pt.* FROM personal_tasks pt
      WHERE pt.created_by = ? AND pt.active = 1 AND pt.frequency = 'once'
      AND pt.completed_at IS NULL
      AND (pt.target_date = ? OR pt.target_date < ?)
      AND (pt.template_id IS NULL
        OR EXISTS (SELECT 1 FROM personal_tasks parent
                   WHERE parent.id = pt.template_id AND parent.frequency = 'once'))
      ORDER BY pt.target_date DESC, pt.template_id NULLS LAST, pt.created_at DESC`;
    const tasks = this.db.prepare(sql).all(userId, targetDate, targetDate) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** List completed tasks (active=1, completed_at IS NOT NULL) — for "Completed" view */
  listCompleted(userId: number, days?: number): PersonalTaskWithStatus[] {
    let sql = `SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND completed_at IS NOT NULL`;
    const params: unknown[] = [userId];
    if (days) {
      sql += ` AND completed_at >= date('now', '-' || ? || ' days')`;
      params.push(days);
    }
    sql += ` ORDER BY completed_at DESC`;
    const tasks = this.db.prepare(sql).all(...params) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  /** Check if instances already exist for a date */
  hasInstancesForDate(userId: number, targetDate: string, frequency: "daily" | "weekly"): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM personal_tasks
      WHERE created_by = ? AND target_date = ? AND template_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM personal_tasks t WHERE t.id = personal_tasks.template_id AND t.frequency = ?)
      LIMIT 1
    `).get(userId, targetDate, frequency);
    return !!row;
  }

  /** Delete existing instances for a date so they can be regenerated */
  deleteInstancesForDate(userId: number, targetDate: string, frequency: "daily" | "weekly"): number {
    const result = this.db.prepare(`
      DELETE FROM personal_tasks
      WHERE created_by = ? AND target_date = ? AND template_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM personal_tasks t WHERE t.id = personal_tasks.template_id AND t.frequency = ?)
    `).run(userId, targetDate, frequency);
    return result.changes;
  }

  /** Auto-complete old instances: mark past-date instances as completed if not already */
  autoCompleteOldInstances(userId: number): number {
    const today = getToday();
    const result = this.db.prepare(`
      UPDATE personal_tasks SET completed_at = datetime('now'), updated_at = datetime('now')
      WHERE created_by = ? AND active = 1 AND completed_at IS NULL
      AND template_id IS NOT NULL AND target_date IS NOT NULL AND target_date < ?
    `).run(userId, today);
    return result.changes;
  }

  private static formatDateLabel(dateStr: string, type: "DT" | "WT"): string {
    const d = new Date(dateStr + "T00:00:00Z");
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const day = days[d.getUTCDay()];
    const yy = String(d.getUTCFullYear()).slice(-2);
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${day}_${yy}${mm}${dd}_${type}`;
  }

  /** Generate daily instances from active daily templates for a given date */
  generateDailyInstances(userId: number, targetDate: string): number {
    // Get day of week for the target date to filter by bitmask
    const d = new Date(targetDate + "T00:00:00Z");
    const dayOfWeek = d.getUTCDay();
    const bitmask = 1 << dayOfWeek;

    const templates = this.db.prepare(`
      SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND frequency = 'daily'
      AND template_id IS NULL
      AND (day_of_week IS NULL OR (day_of_week & ?) != 0)
    `).all(userId, bitmask) as PersonalTask[];

    const instanceTitle = PersonalTaskService.formatDateLabel(targetDate, "DT");

    let count = 0;
    for (const tmpl of templates) {
      // Check if instance already exists for this template+date
      const existing = this.db.prepare(
        "SELECT id FROM personal_tasks WHERE template_id = ? AND target_date = ?"
      ).get(tmpl.id, targetDate);
      if (existing) continue;

      // Create instance
      this.db.prepare(
        "INSERT INTO personal_tasks (title, description, frequency, day_of_week, template_id, target_date, created_by) VALUES (?, ?, 'once', NULL, ?, ?, ?)"
      ).run(instanceTitle, tmpl.description, tmpl.id, targetDate, userId);

      // Copy sub-items from template to instance
      const newTask = this.db.prepare(
        "SELECT id FROM personal_tasks WHERE template_id = ? AND target_date = ? ORDER BY id DESC LIMIT 1"
      ).get(tmpl.id, targetDate) as { id: number };

      const templateItems = this.db.prepare(
        "SELECT description, sort_order FROM personal_task_items WHERE task_id = ? ORDER BY sort_order, id"
      ).all(tmpl.id) as { description: string; sort_order: number }[];

      for (const item of templateItems) {
        this.db.prepare(
          "INSERT INTO personal_task_items (task_id, description, sort_order) VALUES (?, ?, ?)"
        ).run(newTask.id, item.description, item.sort_order);
      }

      count++;
    }
    return count;
  }

  /** Generate weekly instances from active weekly templates for a given Saturday date */
  generateWeeklyInstances(userId: number, saturdayDate: string): number {
    const templates = this.db.prepare(`
      SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND frequency = 'weekly'
      AND template_id IS NULL
    `).all(userId) as PersonalTask[];

    let count = 0;
    for (const tmpl of templates) {
      // Check if instance already exists for this template+date
      const existing = this.db.prepare(
        "SELECT id FROM personal_tasks WHERE template_id = ? AND target_date = ?"
      ).get(tmpl.id, saturdayDate);
      if (existing) continue;

      // Create instance
      const weeklyTitle = PersonalTaskService.formatDateLabel(saturdayDate, "WT");
      this.db.prepare(
        "INSERT INTO personal_tasks (title, description, frequency, day_of_week, template_id, target_date, created_by) VALUES (?, ?, 'once', NULL, ?, ?, ?)"
      ).run(weeklyTitle, tmpl.description, tmpl.id, saturdayDate, userId);

      // Copy sub-items from template to instance
      const newTask = this.db.prepare(
        "SELECT id FROM personal_tasks WHERE template_id = ? AND target_date = ? ORDER BY id DESC LIMIT 1"
      ).get(tmpl.id, saturdayDate) as { id: number };

      const templateItems = this.db.prepare(
        "SELECT description, sort_order FROM personal_task_items WHERE task_id = ? ORDER BY sort_order, id"
      ).all(tmpl.id) as { description: string; sort_order: number }[];

      for (const item of templateItems) {
        this.db.prepare(
          "INSERT INTO personal_task_items (task_id, description, sort_order) VALUES (?, ?, ?)"
        ).run(newTask.id, item.description, item.sort_order);
      }

      count++;
    }
    return count;
  }

  /** Cleanup old instances older than N days */
  cleanupOldInstances(daysOld: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const result = this.db.prepare(`
      UPDATE personal_tasks SET active = 0, updated_at = datetime('now')
      WHERE active = 1 AND template_id IS NOT NULL AND target_date IS NOT NULL
      AND target_date < ?
    `).run(cutoffDate);
    return result.changes;
  }

  private addCompletionStatus(tasks: PersonalTask[]): PersonalTaskWithStatus[] {
    const today = getToday();
    const monday = getMondayOfWeek(today);
    const sunday = getSundayOfWeek(today);

    return tasks.map((task) => {
      let completed_today = false;
      let completed_this_week = false;
      let completed = false;

      if (task.frequency === "daily") {
        const row = this.db
          .prepare("SELECT id FROM personal_task_completions WHERE task_id = ? AND completed_date = ?")
          .get(task.id, today);
        completed_today = !!row;
      } else if (task.frequency === "weekly") {
        const row = this.db
          .prepare("SELECT id FROM personal_task_completions WHERE task_id = ? AND completed_date >= ? AND completed_date <= ?")
          .get(task.id, monday, sunday);
        completed_this_week = !!row;
      } else if (task.frequency === "once") {
        const row = this.db
          .prepare("SELECT id FROM personal_task_completions WHERE task_id = ? LIMIT 1")
          .get(task.id);
        completed = !!row;
      }

      return { ...task, completed_today, completed_this_week, completed };
    });
  }

  listForDay(userId: number, dayOfWeek: number): PersonalTaskWithStatus[] {
    // Return daily instances for today's date, plus one-off tasks for today
    const today = getToday();

    const sql = `SELECT * FROM personal_tasks
      WHERE created_by = ? AND active = 1 AND target_date = ?
      AND (
        (template_id IS NOT NULL AND EXISTS (SELECT 1 FROM personal_tasks t WHERE t.id = personal_tasks.template_id AND t.frequency = 'daily'))
        OR (template_id IS NULL AND frequency = 'once')
      )
      ORDER BY created_at DESC`;
    const tasks = this.db.prepare(sql).all(userId, today) as PersonalTask[];

    return this.addCompletionStatus(tasks);
  }

  listInactive(userId: number, frequency?: string): PersonalTaskWithStatus[] {
    // Get parent archived tasks (templates and standalone one-offs)
    let parentSql = "SELECT * FROM personal_tasks WHERE created_by = ? AND active = 0 AND template_id IS NULL";
    const parentParams: unknown[] = [userId];

    if (frequency) {
      parentSql += " AND frequency = ?";
      parentParams.push(frequency);
    }

    parentSql += " ORDER BY updated_at DESC";
    const parents = this.db.prepare(parentSql).all(...parentParams) as PersonalTask[];

    // Also get archived instance tasks (generated from templates) and their children
    let instanceSql = `SELECT * FROM personal_tasks WHERE created_by = ? AND active = 0 AND template_id IS NOT NULL`;
    const instanceParams: unknown[] = [userId];

    if (frequency) {
      // For daily/weekly filter, get instances whose parent template matches the frequency
      instanceSql += ` AND EXISTS (SELECT 1 FROM personal_tasks t WHERE t.id = personal_tasks.template_id AND t.frequency = ?)`;
      instanceParams.push(frequency);
    }

    instanceSql += " ORDER BY updated_at DESC";
    const instances = this.db.prepare(instanceSql).all(...instanceParams) as PersonalTask[];

    // Combine: parents first, then interleave instances after their parent
    const allTasks: PersonalTask[] = [];
    const instancesByParent = new Map<number, PersonalTask[]>();
    const orphanInstances: PersonalTask[] = [];

    for (const inst of instances) {
      if (inst.template_id != null) {
        if (!instancesByParent.has(inst.template_id)) {
          instancesByParent.set(inst.template_id, []);
        }
        instancesByParent.get(inst.template_id)!.push(inst);
      }
    }

    for (const parent of parents) {
      allTasks.push(parent);
      const children = instancesByParent.get(parent.id);
      if (children) {
        allTasks.push(...children);
        instancesByParent.delete(parent.id);
      }
    }

    // Add remaining instances (whose parent is an instance itself, e.g. one-offs attached to daily instances)
    for (const [, children] of instancesByParent) {
      orphanInstances.push(...children);
    }
    allTasks.push(...orphanInstances);

    return this.addCompletionStatus(allTasks);
  }

  getById(id: number): PersonalTask | null {
    return (
      (this.db
        .prepare("SELECT * FROM personal_tasks WHERE id = ?")
        .get(id) as PersonalTask | null) ?? null
    );
  }

  create(params: {
    title: string;
    description?: string | null;
    frequency: string;
    day_of_week?: number | null;
    due_date?: string | null;
    template_id?: number | null;
    target_date?: string | null;
    createdBy: number;
  }): PersonalTask {
    const result = this.db
      .prepare(
        "INSERT INTO personal_tasks (title, description, frequency, day_of_week, due_date, template_id, target_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
      )
      .get(
        params.title,
        params.description ?? null,
        params.frequency,
        params.day_of_week ?? null,
        params.due_date ?? null,
        params.template_id ?? null,
        params.target_date ?? null,
        params.createdBy
      ) as PersonalTask;

    this.auditService.log({
      userId: params.createdBy,
      actionType: "personal_task_create",
      resourceType: "personal_task",
      resourceId: String(result.id),
      details: { title: params.title, frequency: params.frequency, template_id: params.template_id },
    });

    return result;
  }

  update(
    id: number,
    updates: {
      title?: string;
      description?: string | null;
      frequency?: string;
      day_of_week?: number | null;
      due_date?: string | null;
      active?: number;
      template_id?: number | null;
    },
    userId: number
  ): PersonalTask | null {
    const existing = this.db
      .prepare("SELECT * FROM personal_tasks WHERE id = ?")
      .get(id) as PersonalTask | null;
    if (!existing) return null;

    const title = updates.title ?? existing.title;
    const description =
      updates.description !== undefined
        ? updates.description
        : existing.description;
    const frequency = updates.frequency ?? existing.frequency;
    const day_of_week =
      updates.day_of_week !== undefined
        ? updates.day_of_week
        : existing.day_of_week;
    const due_date =
      updates.due_date !== undefined ? updates.due_date : existing.due_date;
    const active = updates.active !== undefined ? updates.active : existing.active;
    const template_id =
      updates.template_id !== undefined ? updates.template_id : (existing as unknown as Record<string, unknown>).template_id as number | null;

    this.db
      .prepare(
        "UPDATE personal_tasks SET title = ?, description = ?, frequency = ?, day_of_week = ?, due_date = ?, active = ?, template_id = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(title, description, frequency, day_of_week, due_date, active, template_id, id);

    this.auditService.log({
      userId,
      actionType: "personal_task_update",
      resourceType: "personal_task",
      resourceId: String(id),
      details: updates,
    });

    return this.db
      .prepare("SELECT * FROM personal_tasks WHERE id = ?")
      .get(id) as PersonalTask;
  }

  delete(id: number, userId: number): boolean {
    const existing = this.db
      .prepare("SELECT * FROM personal_tasks WHERE id = ?")
      .get(id) as PersonalTask | null;
    if (!existing) return false;

    this.db.transaction(() => {
      // If this is a template, also delete all generated instances
      const childIds = this.db.prepare(
        "SELECT id FROM personal_tasks WHERE template_id = ?"
      ).all(id) as { id: number }[];

      for (const child of childIds) {
        this.db.prepare("DELETE FROM personal_task_completions WHERE task_id = ?").run(child.id);
        this.db.prepare("DELETE FROM personal_task_items WHERE task_id = ?").run(child.id);
        this.db.prepare("DELETE FROM personal_tasks WHERE id = ?").run(child.id);
      }

      this.db
        .prepare("DELETE FROM personal_task_completions WHERE task_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM personal_task_items WHERE task_id = ?").run(id);
      this.db.prepare("DELETE FROM personal_tasks WHERE id = ?").run(id);
    });

    this.auditService.log({
      userId,
      actionType: "personal_task_delete",
      resourceType: "personal_task",
      resourceId: String(id),
      details: { title: existing.title },
    });

    return true;
  }

  toggleCompletion(taskId: number, date: string): boolean {
    const existing = this.db
      .prepare(
        "SELECT id FROM personal_task_completions WHERE task_id = ? AND completed_date = ?"
      )
      .get(taskId, date) as { id: number } | undefined;

    if (existing) {
      this.db
        .prepare("DELETE FROM personal_task_completions WHERE id = ?")
        .run(existing.id);
      // Clear completed_at when uncompleting
      this.db
        .prepare("UPDATE personal_tasks SET completed_at = NULL WHERE id = ?")
        .run(taskId);
      return false;
    }

    this.db
      .prepare(
        "INSERT INTO personal_task_completions (task_id, completed_date) VALUES (?, ?)"
      )
      .run(taskId, date);
    // Set completed_at timestamp for auto-archive tracking
    this.db
      .prepare("UPDATE personal_tasks SET completed_at = datetime('now') WHERE id = ?")
      .run(taskId);
    return true;
  }

  getCompletions(
    taskId: number,
    from: string,
    to: string
  ): { completed_date: string }[] {
    return this.db
      .prepare(
        "SELECT completed_date FROM personal_task_completions WHERE task_id = ? AND completed_date >= ? AND completed_date <= ? ORDER BY completed_date"
      )
      .all(taskId, from, to) as { completed_date: string }[];
  }

  // ===================== TASK ITEMS (sub-items) =====================

  listItems(taskId: number): PersonalTaskItem[] {
    return this.db
      .prepare(
        "SELECT * FROM personal_task_items WHERE task_id = ? ORDER BY sort_order, id"
      )
      .all(taskId) as PersonalTaskItem[];
  }

  addItem(taskId: number, description: string, sortOrder?: number): PersonalTaskItem {
    const order = sortOrder ?? (
      (this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM personal_task_items WHERE task_id = ?")
        .get(taskId) as { next_order: number }).next_order
    );

    return this.db
      .prepare(
        "INSERT INTO personal_task_items (task_id, description, sort_order) VALUES (?, ?, ?) RETURNING *"
      )
      .get(taskId, description, order) as PersonalTaskItem;
  }

  updateItem(
    itemId: number,
    updates: { description?: string; sort_order?: number; completed?: number }
  ): PersonalTaskItem | null {
    const existing = this.db
      .prepare("SELECT * FROM personal_task_items WHERE id = ?")
      .get(itemId) as PersonalTaskItem | null;
    if (!existing) return null;

    const description = updates.description ?? existing.description;
    const sort_order = updates.sort_order ?? existing.sort_order;
    const completed = updates.completed !== undefined ? updates.completed : existing.completed;

    this.db
      .prepare(
        "UPDATE personal_task_items SET description = ?, sort_order = ?, completed = ? WHERE id = ?"
      )
      .run(description, sort_order, completed, itemId);

    return this.db
      .prepare("SELECT * FROM personal_task_items WHERE id = ?")
      .get(itemId) as PersonalTaskItem;
  }

  deleteItem(itemId: number): boolean {
    const result = this.db
      .prepare("DELETE FROM personal_task_items WHERE id = ?")
      .run(itemId);
    return result.changes > 0;
  }

  toggleItemCompletion(itemId: number): PersonalTaskItem | null {
    const existing = this.db
      .prepare("SELECT * FROM personal_task_items WHERE id = ?")
      .get(itemId) as PersonalTaskItem | null;
    if (!existing) return null;

    const newCompleted = existing.completed ? 0 : 1;
    this.db
      .prepare("UPDATE personal_task_items SET completed = ? WHERE id = ?")
      .run(newCompleted, itemId);

    return this.db
      .prepare("SELECT * FROM personal_task_items WHERE id = ?")
      .get(itemId) as PersonalTaskItem;
  }

  archiveTask(taskId: number, userId: number): PersonalTask | null {
    // Archive the task itself
    const archived = this.update(taskId, { active: 0 }, userId);

    // Also archive any child one-off tasks attached to this task
    if (archived) {
      const children = this.db.prepare(
        "SELECT id FROM personal_tasks WHERE template_id = ? AND active = 1"
      ).all(taskId) as { id: number }[];

      for (const child of children) {
        this.db.prepare(
          "UPDATE personal_tasks SET active = 0, updated_at = datetime('now') WHERE id = ?"
        ).run(child.id);
      }

      if (children.length > 0) {
        this.auditService.log({
          userId,
          actionType: "personal_task_update",
          resourceType: "personal_task",
          resourceId: String(taskId),
          details: { archived_children: children.length },
        });
      }
    }

    return archived;
  }

  getArchiveEligible(): PersonalTask[] {
    const now = new Date();
    const completedCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

    // Archive completed instances (template_id IS NOT NULL) after 48h
    // Also archive completed one-off tasks after 48h
    return this.db.prepare(`
      SELECT * FROM personal_tasks
      WHERE active = 1 AND completed_at IS NOT NULL
      AND completed_at < ?
      AND frequency = 'once'
    `).all(completedCutoff) as PersonalTask[];
  }

  autoArchive(): number {
    const eligible = this.getArchiveEligible();
    let count = 0;
    for (const task of eligible) {
      this.db.prepare(
        "UPDATE personal_tasks SET active = 0, updated_at = datetime('now') WHERE id = ?"
      ).run(task.id);
      count++;

      // Also archive child one-off tasks attached to this task
      const childResult = this.db.prepare(
        "UPDATE personal_tasks SET active = 0, updated_at = datetime('now') WHERE template_id = ? AND active = 1"
      ).run(task.id);
      count += childResult.changes;
    }
    return count;
  }
}
