import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { PlanService } from "../../src/services/plan-service.js";
import { StepTemplateService } from "../../src/services/step-template-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-step-templates.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

let db: DatabaseService;
let auditService: AuditService;
let planService: PlanService;
let templateService: StepTemplateService;
let userId: number;
let projectId: number;

beforeEach(() => {
  cleanup();
  db = new DatabaseService(TEST_DB);
  auditService = new AuditService(db);
  planService = new PlanService(db, auditService);
  templateService = new StepTemplateService(db, auditService);

  db.prepare(
    "INSERT INTO users (telegram_id, username, role, active) VALUES (?, ?, ?, ?)"
  ).run(12345, "testuser", "owner", 1);
  userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO projects (directory_name, display_name) VALUES (?, ?)"
  ).run("test-project", "Test Project");
  projectId = (db.prepare("SELECT id FROM projects WHERE directory_name = 'test-project'").get() as { id: number }).id;
});

afterEach(() => {
  db.close();
  cleanup();
});

// ===================== TEMPLATE CRUD =====================

describe("StepTemplateService CRUD", () => {
  it("creates a template", () => {
    const t = templateService.create("My Template", userId);
    expect(t.id).toBeGreaterThan(0);
    expect(t.name).toBe("My Template");
    expect(t.created_by).toBe(userId);
  });

  it("lists templates ordered by name", () => {
    templateService.create("Zebra", userId);
    templateService.create("Alpha", userId);
    templateService.create("Middle", userId);

    const list = templateService.list();
    expect(list).toHaveLength(3);
    expect(list[0].name).toBe("Alpha");
    expect(list[1].name).toBe("Middle");
    expect(list[2].name).toBe("Zebra");
  });

  it("gets template by ID with items", () => {
    const t = templateService.create("Detailed", userId);
    templateService.addItem(t.id, "Step 1");
    templateService.addItem(t.id, "Step 2");

    const full = templateService.getById(t.id);
    expect(full).not.toBeNull();
    expect(full!.name).toBe("Detailed");
    expect(full!.items).toHaveLength(2);
    expect(full!.items[0].description).toBe("Step 1");
    expect(full!.items[1].description).toBe("Step 2");
  });

  it("returns null for non-existent template", () => {
    expect(templateService.getById(999)).toBeNull();
  });

  it("updates template name", () => {
    const t = templateService.create("Old Name", userId);
    const updated = templateService.updateName(t.id, "New Name", userId);
    expect(updated?.name).toBe("New Name");
  });

  it("returns null when updating non-existent template", () => {
    expect(templateService.updateName(999, "Name", userId)).toBeNull();
  });

  it("deletes template with cascade", () => {
    const t = templateService.create("To Delete", userId);
    templateService.addItem(t.id, "Item 1");
    templateService.addItem(t.id, "Item 2");

    expect(templateService.delete(t.id, userId)).toBe(true);
    expect(templateService.getById(t.id)).toBeNull();

    // Items should be cascade deleted
    const items = db.prepare("SELECT * FROM step_template_items WHERE template_id = ?").all(t.id);
    expect(items).toHaveLength(0);
  });

  it("returns false when deleting non-existent template", () => {
    expect(templateService.delete(999, userId)).toBe(false);
  });
});

// ===================== ITEM CRUD =====================

describe("StepTemplateService Item CRUD", () => {
  it("adds item with auto-incrementing order", () => {
    const t = templateService.create("Template", userId);
    const i1 = templateService.addItem(t.id, "First");
    const i2 = templateService.addItem(t.id, "Second");
    const i3 = templateService.addItem(t.id, "Third");

    expect(i1.item_order).toBe(1);
    expect(i2.item_order).toBe(2);
    expect(i3.item_order).toBe(3);
  });

  it("updates item description", () => {
    const t = templateService.create("Template", userId);
    const item = templateService.addItem(t.id, "Original");

    const updated = templateService.updateItem(item.id, { description: "Edited" });
    expect(updated?.description).toBe("Edited");
    expect(updated?.item_order).toBe(1);
  });

  it("updates item order", () => {
    const t = templateService.create("Template", userId);
    const item = templateService.addItem(t.id, "Step");

    const updated = templateService.updateItem(item.id, { item_order: 5 });
    expect(updated?.item_order).toBe(5);
    expect(updated?.description).toBe("Step");
  });

  it("returns null when updating non-existent item", () => {
    expect(templateService.updateItem(999, { description: "x" })).toBeNull();
  });

  it("deletes item", () => {
    const t = templateService.create("Template", userId);
    const item = templateService.addItem(t.id, "To Delete");

    expect(templateService.deleteItem(item.id)).toBe(true);

    const full = templateService.getById(t.id);
    expect(full!.items).toHaveLength(0);
  });

  it("returns false when deleting non-existent item", () => {
    expect(templateService.deleteItem(999)).toBe(false);
  });
});

// ===================== APPLY TO PLAN =====================

describe("StepTemplateService.applyToPlan", () => {
  it("copies template items as plan steps", () => {
    const t = templateService.create("Template", userId);
    templateService.addItem(t.id, "Design");
    templateService.addItem(t.id, "Implement");
    templateService.addItem(t.id, "Test");

    const plan = planService.create(projectId, "My Plan", null, userId);
    const result = templateService.applyToPlan(t.id, plan.id);

    expect(result.addedCount).toBe(3);

    const full = planService.getById(plan.id);
    expect(full!.steps).toHaveLength(3);
    expect(full!.steps[0].description).toBe("Design");
    expect(full!.steps[0].step_order).toBe(1);
    expect(full!.steps[1].description).toBe("Implement");
    expect(full!.steps[2].description).toBe("Test");
    expect(full!.steps[2].step_order).toBe(3);
  });

  it("appends after existing plan steps", () => {
    const plan = planService.create(projectId, "Existing Plan", null, userId);
    planService.addStep(plan.id, "Existing Step 1");
    planService.addStep(plan.id, "Existing Step 2");

    const t = templateService.create("Template", userId);
    templateService.addItem(t.id, "New Step A");
    templateService.addItem(t.id, "New Step B");

    templateService.applyToPlan(t.id, plan.id);

    const full = planService.getById(plan.id);
    expect(full!.steps).toHaveLength(4);
    expect(full!.steps[0].description).toBe("Existing Step 1");
    expect(full!.steps[0].step_order).toBe(1);
    expect(full!.steps[1].description).toBe("Existing Step 2");
    expect(full!.steps[1].step_order).toBe(2);
    expect(full!.steps[2].description).toBe("New Step A");
    expect(full!.steps[2].step_order).toBe(3);
    expect(full!.steps[3].description).toBe("New Step B");
    expect(full!.steps[3].step_order).toBe(4);
  });

  it("handles empty template gracefully", () => {
    const t = templateService.create("Empty", userId);
    const plan = planService.create(projectId, "Plan", null, userId);

    const result = templateService.applyToPlan(t.id, plan.id);
    expect(result.addedCount).toBe(0);

    const full = planService.getById(plan.id);
    expect(full!.steps).toHaveLength(0);
  });

  it("returns zero for non-existent template", () => {
    const plan = planService.create(projectId, "Plan", null, userId);
    const result = templateService.applyToPlan(999, plan.id);
    expect(result.addedCount).toBe(0);
  });
});

// ===================== CREATE FROM PLAN =====================

describe("StepTemplateService.createFromPlan", () => {
  it("creates template from plan steps", () => {
    const plan = planService.create(projectId, "Source Plan", null, userId);
    planService.addStep(plan.id, "Step A");
    planService.addStep(plan.id, "Step B");
    planService.addStep(plan.id, "Step C");

    const template = templateService.createFromPlan(plan.id, "From Plan", userId);
    expect(template).not.toBeNull();
    expect(template!.name).toBe("From Plan");
    expect(template!.items).toHaveLength(3);
    expect(template!.items[0].description).toBe("Step A");
    expect(template!.items[0].item_order).toBe(1);
    expect(template!.items[1].description).toBe("Step B");
    expect(template!.items[2].description).toBe("Step C");
    expect(template!.items[2].item_order).toBe(3);
  });

  it("creates template from plan with no steps", () => {
    const plan = planService.create(projectId, "Empty Plan", null, userId);

    const template = templateService.createFromPlan(plan.id, "Empty Template", userId);
    expect(template).not.toBeNull();
    expect(template!.items).toHaveLength(0);
  });

  it("renumbers steps starting from 1", () => {
    const plan = planService.create(projectId, "Plan", null, userId);
    const s1 = planService.addStep(plan.id, "First");
    planService.addStep(plan.id, "Second");
    // Update step order to have gaps
    planService.updateStep(s1.id, { step_order: 5 });

    const template = templateService.createFromPlan(plan.id, "Renumbered", userId);
    expect(template!.items[0].item_order).toBe(1);
    expect(template!.items[1].item_order).toBe(2);
  });
});

// ===================== FULL WORKFLOW =====================

describe("Step Templates full workflow", () => {
  it("create template -> add items -> apply to plan -> save another plan as template", () => {
    // 1. Create a template with items
    const t = templateService.create("Sprint Template", userId);
    templateService.addItem(t.id, "Requirements review");
    templateService.addItem(t.id, "Implementation");
    templateService.addItem(t.id, "Code review");
    templateService.addItem(t.id, "QA testing");

    // 2. Apply to plan A
    const planA = planService.create(projectId, "Sprint 1", null, userId);
    templateService.applyToPlan(t.id, planA.id);

    const fullA = planService.getById(planA.id);
    expect(fullA!.steps).toHaveLength(4);
    expect(fullA!.steps[0].description).toBe("Requirements review");

    // 3. Apply same template to plan B (should work independently)
    const planB = planService.create(projectId, "Sprint 2", null, userId);
    planService.addStep(planB.id, "Pre-existing step");
    templateService.applyToPlan(t.id, planB.id);

    const fullB = planService.getById(planB.id);
    expect(fullB!.steps).toHaveLength(5);
    expect(fullB!.steps[0].description).toBe("Pre-existing step");
    expect(fullB!.steps[1].description).toBe("Requirements review");

    // 4. Add custom steps to plan A and save as new template
    planService.addStep(planA.id, "Deploy to staging");
    planService.addStep(planA.id, "Production release");

    const newTemplate = templateService.createFromPlan(planA.id, "Extended Sprint", userId);
    expect(newTemplate!.items).toHaveLength(6);
    expect(newTemplate!.items[4].description).toBe("Deploy to staging");
    expect(newTemplate!.items[5].description).toBe("Production release");

    // 5. Verify both templates exist
    const allTemplates = templateService.list();
    expect(allTemplates).toHaveLength(2);
  });
});
