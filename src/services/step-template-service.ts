import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface StepTemplate {
  id: number;
  name: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface StepTemplateItem {
  id: number;
  template_id: number;
  item_order: number;
  description: string;
}

export interface StepTemplateWithItems extends StepTemplate {
  items: StepTemplateItem[];
}

export class StepTemplateService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  list(): StepTemplate[] {
    return this.db
      .prepare("SELECT * FROM step_templates ORDER BY name")
      .all() as StepTemplate[];
  }

  getById(id: number): StepTemplateWithItems | null {
    const template = this.db
      .prepare("SELECT * FROM step_templates WHERE id = ?")
      .get(id) as StepTemplate | null;
    if (!template) return null;

    const items = this.db
      .prepare("SELECT * FROM step_template_items WHERE template_id = ? ORDER BY item_order")
      .all(id) as StepTemplateItem[];

    return { ...template, items };
  }

  create(name: string, createdBy: number): StepTemplate {
    const result = this.db
      .prepare(
        "INSERT INTO step_templates (name, created_by) VALUES (?, ?) RETURNING *"
      )
      .get(name, createdBy) as StepTemplate;

    this.auditService.log({
      userId: createdBy,
      actionType: "step_template_create",
      resourceType: "step_template",
      resourceId: String(result.id),
      details: { name }
    });

    return result;
  }

  updateName(id: number, name: string, userId: number): StepTemplate | null {
    const existing = this.db
      .prepare("SELECT * FROM step_templates WHERE id = ?")
      .get(id) as StepTemplate | null;
    if (!existing) return null;

    this.db
      .prepare(
        "UPDATE step_templates SET name = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(name, id);

    this.auditService.log({
      userId,
      actionType: "step_template_update",
      resourceType: "step_template",
      resourceId: String(id),
      details: { name }
    });

    return this.db
      .prepare("SELECT * FROM step_templates WHERE id = ?")
      .get(id) as StepTemplate;
  }

  delete(id: number, userId: number): boolean {
    const existing = this.db
      .prepare("SELECT * FROM step_templates WHERE id = ?")
      .get(id) as StepTemplate | null;
    if (!existing) return false;

    this.db.prepare("DELETE FROM step_templates WHERE id = ?").run(id);

    this.auditService.log({
      userId,
      actionType: "step_template_delete",
      resourceType: "step_template",
      resourceId: String(id),
      details: { name: existing.name }
    });

    return true;
  }

  addItem(templateId: number, description: string): StepTemplateItem {
    const maxOrder = this.db
      .prepare(
        "SELECT COALESCE(MAX(item_order), 0) as max_order FROM step_template_items WHERE template_id = ?"
      )
      .get(templateId) as { max_order: number };

    return this.db
      .prepare(
        "INSERT INTO step_template_items (template_id, item_order, description) VALUES (?, ?, ?) RETURNING *"
      )
      .get(templateId, maxOrder.max_order + 1, description) as StepTemplateItem;
  }

  updateItem(
    itemId: number,
    updates: { description?: string; item_order?: number }
  ): StepTemplateItem | null {
    const existing = this.db
      .prepare("SELECT * FROM step_template_items WHERE id = ?")
      .get(itemId) as StepTemplateItem | null;
    if (!existing) return null;

    const description = updates.description ?? existing.description;
    const item_order = updates.item_order ?? existing.item_order;

    this.db
      .prepare(
        "UPDATE step_template_items SET description = ?, item_order = ? WHERE id = ?"
      )
      .run(description, item_order, itemId);

    return this.db
      .prepare("SELECT * FROM step_template_items WHERE id = ?")
      .get(itemId) as StepTemplateItem;
  }

  deleteItem(itemId: number): boolean {
    const existing = this.db
      .prepare("SELECT * FROM step_template_items WHERE id = ?")
      .get(itemId) as StepTemplateItem | null;
    if (!existing) return false;

    this.db.prepare("DELETE FROM step_template_items WHERE id = ?").run(itemId);
    return true;
  }

  applyToPlan(templateId: number, planId: number): { addedCount: number } {
    const template = this.getById(templateId);
    if (!template) return { addedCount: 0 };

    return this.db.transaction(() => {
      const maxOrder = this.db
        .prepare(
          "SELECT COALESCE(MAX(step_order), 0) as max_order FROM plan_steps WHERE plan_id = ?"
        )
        .get(planId) as { max_order: number };

      let offset = maxOrder.max_order;

      for (const item of template.items) {
        offset++;
        this.db
          .prepare(
            "INSERT INTO plan_steps (plan_id, step_order, description) VALUES (?, ?, ?)"
          )
          .run(planId, offset, item.description);
      }

      return { addedCount: template.items.length };
    });
  }

  createFromPlan(
    planId: number,
    name: string,
    createdBy: number
  ): StepTemplateWithItems | null {
    const steps = this.db
      .prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_order")
      .all(planId) as { description: string }[];

    return this.db.transaction(() => {
      const template = this.db
        .prepare(
          "INSERT INTO step_templates (name, created_by) VALUES (?, ?) RETURNING *"
        )
        .get(name, createdBy) as StepTemplate;

      const items: StepTemplateItem[] = [];
      for (let i = 0; i < steps.length; i++) {
        const item = this.db
          .prepare(
            "INSERT INTO step_template_items (template_id, item_order, description) VALUES (?, ?, ?) RETURNING *"
          )
          .get(template.id, i + 1, steps[i].description) as StepTemplateItem;
        items.push(item);
      }

      this.auditService.log({
        userId: createdBy,
        actionType: "step_template_create_from_plan",
        resourceType: "step_template",
        resourceId: String(template.id),
        details: { name, planId, stepCount: steps.length }
      });

      return { ...template, items };
    });
  }
}
