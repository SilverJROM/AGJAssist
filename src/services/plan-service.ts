import fs from "node:fs";
import path from "node:path";
import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface Plan {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface PlanStep {
  id: number;
  plan_id: number;
  step_order: number;
  description: string;
  completed: number;
  created_at: string;
}

export interface PlanWithSteps extends Plan {
  steps: PlanStep[];
  note_ids: number[];
}

export class PlanService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  list(projectId: number, status?: string): Plan[] {
    let sql = "SELECT * FROM plans WHERE project_id = ?";
    const params: unknown[] = [projectId];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params) as Plan[];
  }

  getById(id: number): PlanWithSteps | null {
    const plan = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
    if (!plan) return null;

    const steps = this.db
      .prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_order")
      .all(id) as PlanStep[];

    const noteIds = (
      this.db
        .prepare("SELECT note_id FROM plan_notes WHERE plan_id = ?")
        .all(id) as { note_id: number }[]
    ).map((r) => r.note_id);

    return { ...plan, steps, note_ids: noteIds };
  }

  create(projectId: number, title: string, description: string | null, createdBy: number): Plan {
    const result = this.db
      .prepare(
        "INSERT INTO plans (project_id, title, description, created_by) VALUES (?, ?, ?, ?) RETURNING *"
      )
      .get(projectId, title, description, createdBy) as Plan;

    this.auditService.log({
      userId: createdBy,
      actionType: "plan_create",
      resourceType: "plan",
      resourceId: String(result.id),
      details: { project_id: projectId, title }
    });

    return result;
  }

  update(
    id: number,
    updates: { title?: string; description?: string | null; status?: string },
    userId?: number
  ): Plan | null {
    const existing = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
    if (!existing) return null;

    const title = updates.title ?? existing.title;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const status = updates.status ?? existing.status;

    this.db
      .prepare(
        "UPDATE plans SET title = ?, description = ?, status = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(title, description, status, id);

    this.auditService.log({
      userId,
      actionType: "plan_update",
      resourceType: "plan",
      resourceId: String(id),
      details: updates
    });

    return this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Plan;
  }

  delete(id: number, userId?: number): boolean {
    const existing = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Plan | null;
    if (!existing) return false;

    this.db.transaction(() => {
      // Delete related data first
      this.db.prepare("DELETE FROM plan_notes WHERE plan_id = ?").run(id);
      this.db.prepare("DELETE FROM plan_steps WHERE plan_id = ?").run(id);
      this.db.prepare("DELETE FROM plans WHERE id = ?").run(id);
    });

    this.auditService.log({
      userId,
      actionType: "plan_delete",
      resourceType: "plan",
      resourceId: String(id),
      details: { title: existing.title }
    });

    return true;
  }

  addStep(planId: number, description: string): PlanStep {
    const maxOrder = this.db
      .prepare("SELECT COALESCE(MAX(step_order), 0) as max_order FROM plan_steps WHERE plan_id = ?")
      .get(planId) as { max_order: number };

    return this.db
      .prepare(
        "INSERT INTO plan_steps (plan_id, step_order, description) VALUES (?, ?, ?) RETURNING *"
      )
      .get(planId, maxOrder.max_order + 1, description) as PlanStep;
  }

  updateStep(
    stepId: number,
    updates: { description?: string; completed?: boolean; step_order?: number }
  ): PlanStep | null {
    const existing = this.db
      .prepare("SELECT * FROM plan_steps WHERE id = ?")
      .get(stepId) as PlanStep | null;

    if (!existing) return null;

    const description = updates.description ?? existing.description;
    const completed = updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed;
    const step_order = updates.step_order ?? existing.step_order;

    this.db
      .prepare(
        "UPDATE plan_steps SET description = ?, completed = ?, step_order = ? WHERE id = ?"
      )
      .run(description, completed, step_order, stepId);

    return this.db
      .prepare("SELECT * FROM plan_steps WHERE id = ?")
      .get(stepId) as PlanStep;
  }

  getLinkedNotes(planId: number): { id: number; title: string | null; body: string }[] {
    return this.db
      .prepare(
        `SELECT n.id, n.title, n.body FROM notes n
         JOIN plan_notes pn ON pn.note_id = n.id
         WHERE pn.plan_id = ?
         ORDER BY n.created_at`
      )
      .all(planId) as { id: number; title: string | null; body: string }[];
  }

  listPlanFolders(projectRoot: string): { name: string; files: string[] }[] {
    const planDir = path.join(projectRoot, "plan");
    if (!fs.existsSync(planDir)) return [];

    return fs.readdirSync(planDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => {
        const folderPath = path.join(planDir, e.name);
        const files = fs.readdirSync(folderPath)
          .filter(f => !fs.statSync(path.join(folderPath, f)).isDirectory());
        return { name: e.name, files };
      });
  }

  private generatePlanMarkdown(plan: PlanWithSteps): string {
    const notes = this.getLinkedNotes(plan.id);
    const lines: string[] = [];

    lines.push(`# ${plan.title}`);
    lines.push("");
    lines.push(`**Status**: ${plan.status}`);
    lines.push(`**Created**: ${plan.created_at}`);
    lines.push("");

    if (plan.description) {
      lines.push("## Description");
      lines.push("");
      lines.push(plan.description);
      lines.push("");
    }

    if (notes.length > 0) {
      lines.push("## Notes");
      lines.push("");
      for (const note of notes) {
        lines.push(`### ${note.title || "Untitled Note"}`);
        lines.push("");
        lines.push(note.body);
        lines.push("");
      }
    }

    if (plan.steps.length > 0) {
      lines.push("## Steps");
      lines.push("");
      for (const step of plan.steps) {
        const check = step.completed ? "x" : " ";
        lines.push(`- [${check}] ${step.description}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  insertToProject(
    planId: number,
    projectRoot: string,
    targetFolder: string,
    createNew: boolean,
    userId?: number
  ): { path: string; folderName: string } | null {
    const plan = this.getById(planId);
    if (!plan) return null;

    const planDir = path.join(projectRoot, "plan");
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true });
    }

    const folderPath = path.join(planDir, targetFolder);

    // Validate no path traversal
    const resolved = path.resolve(folderPath);
    if (!resolved.startsWith(path.resolve(planDir))) {
      return null;
    }

    if (createNew) {
      if (fs.existsSync(folderPath)) return null; // already exists
      fs.mkdirSync(folderPath, { recursive: true });
    } else {
      if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) return null;
    }

    const content = this.generatePlanMarkdown(plan);
    const filePath = path.join(folderPath, "plan.md");
    fs.writeFileSync(filePath, content, "utf-8");

    // Mark plan as completed
    this.db
      .prepare(
        "UPDATE plans SET status = 'completed', updated_at = datetime('now') WHERE id = ?"
      )
      .run(planId);

    this.auditService.log({
      userId,
      actionType: "plan_insert",
      resourceType: "plan",
      resourceId: String(planId),
      details: { folder: targetFolder, path: `plan/${targetFolder}/plan.md` }
    });

    return { path: `plan/${targetFolder}/plan.md`, folderName: targetFolder };
  }
}
