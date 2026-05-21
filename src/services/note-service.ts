import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface Note {
  id: number;
  project_id: number | null;
  title: string | null;
  body: string;
  status: string;
  tags: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export class NoteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  /** List notes for a specific project (existing behavior) */
  list(projectId: number, status?: string): Note[] {
    let sql = "SELECT * FROM notes WHERE project_id = ?";
    const params: unknown[] = [projectId];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params) as Note[];
  }

  /** List all notes across projects with optional filters, pagination, sorting */
  listAll(filters?: {
    projectId?: number | null;
    status?: string;
    search?: string;
    createdBy?: number;
    sort?: string;
    page?: number;
    limit?: number;
  }): { notes: Note[]; total: number; page: number; totalPages: number } {
    let where = "WHERE 1=1";
    const params: unknown[] = [];

    if (filters?.projectId !== undefined) {
      if (filters.projectId === null) {
        where += " AND project_id IS NULL";
      } else {
        where += " AND project_id = ?";
        params.push(filters.projectId);
      }
    }

    if (filters?.status) {
      where += " AND status = ?";
      params.push(filters.status);
    }

    if (filters?.search) {
      where += " AND (title LIKE ? OR body LIKE ?)";
      const term = `%${filters.search}%`;
      params.push(term, term);
    }

    if (filters?.createdBy) {
      where += " AND created_by = ?";
      params.push(filters.createdBy);
    }

    // Count total
    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM notes ${where}`).get(...params) as { cnt: number };
    const total = countRow.cnt;

    // Sort
    const sortMap: Record<string, string> = {
      newest: "created_at DESC",
      oldest: "created_at ASC",
      updated: "updated_at DESC",
      title: "COALESCE(title, body) ASC"
    };
    const orderBy = sortMap[filters?.sort || "newest"] || sortMap.newest;

    // Pagination
    const limit = filters?.limit || 20;
    const page = filters?.page || 1;
    const offset = (page - 1) * limit;
    const totalPages = Math.ceil(total / limit) || 1;

    const sql = `SELECT * FROM notes ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const notes = this.db.prepare(sql).all(...params, limit, offset) as Note[];

    return { notes, total, page, totalPages };
  }

  getById(id: number): Note | null {
    return this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Note | null;
  }

  create(
    body: string,
    createdBy: number,
    projectId?: number | null,
    title?: string,
    tags?: string[]
  ): Note {
    const result = this.db
      .prepare(
        "INSERT INTO notes (project_id, title, body, created_by, tags) VALUES (?, ?, ?, ?, ?) RETURNING *"
      )
      .get(
        projectId ?? null,
        title || null,
        body,
        createdBy,
        tags ? JSON.stringify(tags) : null
      ) as Note;

    this.auditService.log({
      userId: createdBy,
      actionType: "note_create",
      resourceType: "note",
      resourceId: String(result.id),
      details: { project_id: projectId ?? null, title }
    });

    return result;
  }

  update(
    id: number,
    updates: { title?: string | null; body?: string; status?: string; tags?: string[]; project_id?: number | null },
    userId?: number
  ): Note | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const title = updates.title !== undefined ? updates.title : existing.title;
    const body = updates.body ?? existing.body;
    const status = updates.status ?? existing.status;
    const tags = updates.tags ? JSON.stringify(updates.tags) : existing.tags;
    const projectId = updates.project_id !== undefined ? updates.project_id : existing.project_id;

    this.db
      .prepare(
        "UPDATE notes SET project_id = ?, title = ?, body = ?, status = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(projectId, title, body, status, tags, id);

    this.auditService.log({
      userId,
      actionType: "note_update",
      resourceType: "note",
      resourceId: String(id),
      details: updates
    });

    return this.getById(id);
  }

  delete(id: number, userId?: number): boolean {
    const result = this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    if (result.changes > 0) {
      this.auditService.log({
        userId,
        actionType: "note_delete",
        resourceType: "note",
        resourceId: String(id)
      });
    }
    return result.changes > 0;
  }

  addToPlan(
    noteIds: number[],
    projectId: number,
    userId: number,
    planId?: number,
    newPlanTitle?: string
  ): { planId: number; addedCount: number } | null {
    const notes: Note[] = [];
    for (const nid of noteIds) {
      const note = this.getById(nid);
      if (!note || note.status !== "open") return null;
      // Allow unattached notes to be added to any project's plan
      if (note.project_id !== null && note.project_id !== projectId) return null;
      notes.push(note);
    }

    let targetPlanId: number;

    if (planId) {
      const plan = this.db
        .prepare("SELECT id, project_id FROM plans WHERE id = ?")
        .get(planId) as { id: number; project_id: number } | undefined;
      if (!plan || plan.project_id !== projectId) return null;
      targetPlanId = planId;
    } else if (newPlanTitle) {
      const plan = this.db
        .prepare(
          "INSERT INTO plans (project_id, title, created_by) VALUES (?, ?, ?) RETURNING id"
        )
        .get(projectId, newPlanTitle, userId) as { id: number };
      targetPlanId = plan.id;

      this.auditService.log({
        userId,
        actionType: "plan_create",
        resourceType: "plan",
        resourceId: String(targetPlanId),
        details: { project_id: projectId, title: newPlanTitle, from_notes: noteIds }
      });
    } else {
      return null;
    }

    const insertLink = this.db.prepare(
      "INSERT OR IGNORE INTO plan_notes (plan_id, note_id) VALUES (?, ?)"
    );
    const markPromoted = this.db.prepare(
      "UPDATE notes SET status = 'promoted', updated_at = datetime('now') WHERE id = ?"
    );

    let addedCount = 0;
    this.db.transaction(() => {
      for (const note of notes) {
        insertLink.run(targetPlanId, note.id);
        markPromoted.run(note.id);
        addedCount++;
      }
    });

    this.auditService.log({
      userId,
      actionType: "notes_add_to_plan",
      resourceType: "plan",
      resourceId: String(targetPlanId),
      details: { note_ids: noteIds, added_count: addedCount }
    });

    return { planId: targetPlanId, addedCount };
  }

  promote(id: number, planTitle: string, userId: number, targetProjectId?: number): { noteId: number; planId: number } | null {
    const note = this.getById(id);
    if (!note || note.status !== "open") return null;

    const projectId = note.project_id ?? targetProjectId;
    if (!projectId) return null;

    const plan = this.db
      .prepare(
        "INSERT INTO plans (project_id, title, description, created_by) VALUES (?, ?, ?, ?) RETURNING id"
      )
      .get(projectId, planTitle, note.body, userId) as { id: number };

    this.db
      .prepare("INSERT INTO plan_notes (plan_id, note_id) VALUES (?, ?)")
      .run(plan.id, id);

    this.db
      .prepare("UPDATE notes SET status = 'promoted', updated_at = datetime('now') WHERE id = ?")
      .run(id);

    this.auditService.log({
      userId,
      actionType: "note_promote",
      resourceType: "note",
      resourceId: String(id),
      details: { plan_id: plan.id, plan_title: planTitle }
    });

    return { noteId: id, planId: plan.id };
  }
}
