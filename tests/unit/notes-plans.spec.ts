import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { NoteService } from "../../src/services/note-service.js";
import { PlanService } from "../../src/services/plan-service.js";
import { AuditService } from "../../src/services/audit-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-notes-plans.sqlite");
const TEST_PROJECT_ROOT = path.join("data", "test-project-root");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  if (fs.existsSync(TEST_PROJECT_ROOT)) {
    fs.rmSync(TEST_PROJECT_ROOT, { recursive: true });
  }
}

let db: DatabaseService;
let auditService: AuditService;
let noteService: NoteService;
let planService: PlanService;
let userId: number;
let projectId: number;

beforeEach(() => {
  cleanup();
  db = new DatabaseService(TEST_DB);
  auditService = new AuditService(db);
  noteService = new NoteService(db, auditService);
  planService = new PlanService(db, auditService);

  // Create test user
  db.prepare(
    "INSERT INTO users (telegram_id, username, role, active) VALUES (?, ?, ?, ?)"
  ).run(12345, "testuser", "owner", 1);
  userId = (db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number }).id;

  // Create test project
  db.prepare(
    "INSERT INTO projects (directory_name, display_name) VALUES (?, ?)"
  ).run("test-project", "Test Project");
  projectId = (db.prepare("SELECT id FROM projects WHERE directory_name = 'test-project'").get() as { id: number }).id;

  // Create project root for filesystem tests
  fs.mkdirSync(TEST_PROJECT_ROOT, { recursive: true });
});

afterEach(() => {
  db.close();
  cleanup();
});

// ===================== NOTE SERVICE TESTS =====================

describe("NoteService", () => {
  it("creates a note with open status by default", () => {
    const note = noteService.create("my note body", userId, projectId, "My Title");
    expect(note.id).toBeGreaterThan(0);
    expect(note.status).toBe("open");
    expect(note.title).toBe("My Title");
    expect(note.body).toBe("my note body");
    expect(note.project_id).toBe(projectId);
  });

  it("lists only open notes when status=open", () => {
    noteService.create("note1", userId, projectId);
    noteService.create("note2", userId, projectId);
    const n3 = noteService.create("note3", userId, projectId);

    // Promote one note manually
    noteService.update(n3.id, { status: "promoted" }, userId);

    const openNotes = noteService.list(projectId, "open");
    expect(openNotes).toHaveLength(2);
    expect(openNotes.every(n => n.status === "open")).toBe(true);
  });

  it("lists all notes when no status filter", () => {
    noteService.create("note1", userId, projectId);
    const n2 = noteService.create("note2", userId, projectId);
    noteService.update(n2.id, { status: "promoted" }, userId);

    const allNotes = noteService.list(projectId);
    expect(allNotes).toHaveLength(2);
  });

  it("deletes a note", () => {
    const note = noteService.create("to delete", userId, projectId);
    expect(noteService.delete(note.id, userId)).toBe(true);
    expect(noteService.getById(note.id)).toBeFalsy();
  });

  it("updates a note body and title", () => {
    const note = noteService.create("original", userId, projectId, "Original Title");
    const updated = noteService.update(note.id, { body: "updated body", title: "New Title" }, userId);
    expect(updated?.body).toBe("updated body");
    expect(updated?.title).toBe("New Title");
    expect(updated?.status).toBe("open");
  });

  it("updates only note body, preserving title", () => {
    const note = noteService.create("old body", userId, projectId, "Keep Title");
    const updated = noteService.update(note.id, { body: "new body" }, userId);
    expect(updated?.body).toBe("new body");
    expect(updated?.title).toBe("Keep Title");
  });

  it("clears note title to null", () => {
    const note = noteService.create("body", userId, projectId, "Has Title");
    const updated = noteService.update(note.id, { title: null }, userId);
    expect(updated?.title).toBeNull();
    expect(updated?.body).toBe("body");
  });
});

// ===================== PLAN SERVICE TESTS =====================

describe("PlanService", () => {
  it("creates a plan with draft status", () => {
    const plan = planService.create(projectId, "Test Plan", "A description", userId);
    expect(plan.id).toBeGreaterThan(0);
    expect(plan.status).toBe("draft");
    expect(plan.title).toBe("Test Plan");
    expect(plan.project_id).toBe(projectId);
  });

  it("lists plans filtered by status", () => {
    planService.create(projectId, "Plan A", null, userId);
    const p2 = planService.create(projectId, "Plan B", null, userId);

    // Complete plan B
    planService.update(p2.id, { status: "completed" }, userId);

    const draftPlans = planService.list(projectId, "draft");
    expect(draftPlans).toHaveLength(1);
    expect(draftPlans[0].title).toBe("Plan A");

    const completedPlans = planService.list(projectId, "completed");
    expect(completedPlans).toHaveLength(1);
    expect(completedPlans[0].title).toBe("Plan B");
  });

  it("lists all plans when no status filter", () => {
    planService.create(projectId, "Plan A", null, userId);
    const p2 = planService.create(projectId, "Plan B", null, userId);
    planService.update(p2.id, { status: "completed" }, userId);

    const allPlans = planService.list(projectId);
    expect(allPlans).toHaveLength(2);
  });

  it("getById returns plan with steps and note_ids", () => {
    const plan = planService.create(projectId, "Detailed Plan", null, userId);
    planService.addStep(plan.id, "Step 1");
    planService.addStep(plan.id, "Step 2");

    const full = planService.getById(plan.id);
    expect(full).not.toBeNull();
    expect(full!.steps).toHaveLength(2);
    expect(full!.steps[0].description).toBe("Step 1");
    expect(full!.steps[1].description).toBe("Step 2");
    expect(full!.note_ids).toEqual([]);
  });

  it("getById includes linked note IDs", () => {
    const n1 = noteService.create("linked note", userId, projectId);
    const plan = planService.create(projectId, "Noted Plan", null, userId);
    db.prepare("INSERT INTO plan_notes (plan_id, note_id) VALUES (?, ?)").run(plan.id, n1.id);

    const fetched = planService.getById(plan.id);
    expect(fetched!.note_ids).toContain(n1.id);
  });

  it("updates plan status", () => {
    const plan = planService.create(projectId, "Plan X", null, userId);
    const updated = planService.update(plan.id, { status: "completed" }, userId);
    expect(updated?.status).toBe("completed");
  });

  it("adds and updates steps", () => {
    const plan = planService.create(projectId, "Stepped Plan", null, userId);
    const step = planService.addStep(plan.id, "Do something");
    expect(step.completed).toBe(0);
    expect(step.step_order).toBe(1);

    const updated = planService.updateStep(step.id, { completed: true });
    expect(updated?.completed).toBe(1);
  });

  it("edits step description", () => {
    const plan = planService.create(projectId, "Edit Steps Plan", null, userId);
    const step = planService.addStep(plan.id, "Original step");

    const updated = planService.updateStep(step.id, { description: "Edited step" });
    expect(updated?.description).toBe("Edited step");
    expect(updated?.completed).toBe(0); // unchanged
  });

  it("edits plan title and description", () => {
    const plan = planService.create(projectId, "Old Title", "Old desc", userId);

    const updated = planService.update(plan.id, { title: "New Title", description: "New desc" }, userId);
    expect(updated?.title).toBe("New Title");
    expect(updated?.description).toBe("New desc");
    expect(updated?.status).toBe("draft"); // unchanged
  });

  it("edits plan description to null", () => {
    const plan = planService.create(projectId, "Has Desc", "Some description", userId);

    const updated = planService.update(plan.id, { description: null }, userId);
    expect(updated?.description).toBeNull();
    expect(updated?.title).toBe("Has Desc");
  });

  it("getLinkedNotes returns linked notes with content", () => {
    const n1 = noteService.create("note body here", userId, projectId, "Note Title");
    const plan = planService.create(projectId, "Notes Plan", null, userId);
    db.prepare("INSERT INTO plan_notes (plan_id, note_id) VALUES (?, ?)").run(plan.id, n1.id);

    const linkedNotes = planService.getLinkedNotes(plan.id);
    expect(linkedNotes).toHaveLength(1);
    expect(linkedNotes[0].title).toBe("Note Title");
    expect(linkedNotes[0].body).toBe("note body here");
  });
});

// ===================== PLAN INSERT TO PROJECT TESTS =====================

describe("PlanService.insertToProject", () => {
  it("inserts plan markdown to new folder and marks as completed", () => {
    const plan = planService.create(projectId, "Insert Plan", "A plan to insert", userId);
    planService.addStep(plan.id, "Step A");
    planService.addStep(plan.id, "Step B");

    const result = planService.insertToProject(
      plan.id,
      TEST_PROJECT_ROOT,
      "plan-v1",
      true,
      userId
    );

    expect(result).not.toBeNull();
    expect(result!.folderName).toBe("plan-v1");
    expect(result!.path).toBe("plan/plan-v1/plan.md");

    // File should exist on disk
    const filePath = path.join(TEST_PROJECT_ROOT, "plan", "plan-v1", "plan.md");
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Insert Plan");
    expect(content).toContain("Step A");
    expect(content).toContain("Step B");

    // Plan should be marked completed
    const updated = planService.getById(plan.id);
    expect(updated?.status).toBe("completed");
  });

  it("inserts into an existing folder", () => {
    const folderPath = path.join(TEST_PROJECT_ROOT, "plan", "existing");
    fs.mkdirSync(folderPath, { recursive: true });

    const plan = planService.create(projectId, "Existing Folder Plan", null, userId);
    const result = planService.insertToProject(plan.id, TEST_PROJECT_ROOT, "existing", false, userId);

    expect(result).not.toBeNull();
    expect(fs.existsSync(path.join(folderPath, "plan.md"))).toBe(true);
  });

  it("rejects creating a folder that already exists", () => {
    const folderPath = path.join(TEST_PROJECT_ROOT, "plan", "taken");
    fs.mkdirSync(folderPath, { recursive: true });

    const plan = planService.create(projectId, "Dup Folder", null, userId);
    const result = planService.insertToProject(plan.id, TEST_PROJECT_ROOT, "taken", true, userId);

    expect(result).toBeNull();
  });

  it("rejects inserting into non-existent folder when createNew=false", () => {
    const plan = planService.create(projectId, "No Folder", null, userId);
    const result = planService.insertToProject(plan.id, TEST_PROJECT_ROOT, "ghost", false, userId);
    expect(result).toBeNull();
  });

  it("rejects path traversal attempts", () => {
    const plan = planService.create(projectId, "Hacker Plan", null, userId);
    const result = planService.insertToProject(plan.id, TEST_PROJECT_ROOT, "../../etc", true, userId);
    expect(result).toBeNull();
  });

  it("includes linked notes in markdown output", () => {
    const n1 = noteService.create("Important insight", userId, projectId, "Research Note");
    const linkedPlan = planService.create(projectId, "Noted Plan", null, userId);
    db.prepare("INSERT INTO plan_notes (plan_id, note_id) VALUES (?, ?)").run(linkedPlan.id, n1.id);
    const planId = linkedPlan.id;

    planService.addStep(planId, "Follow up on research");

    const result = planService.insertToProject(planId, TEST_PROJECT_ROOT, "noted-plan", true, userId);
    expect(result).not.toBeNull();

    const content = fs.readFileSync(
      path.join(TEST_PROJECT_ROOT, "plan", "noted-plan", "plan.md"),
      "utf-8"
    );
    expect(content).toContain("## Notes");
    expect(content).toContain("### Research Note");
    expect(content).toContain("Important insight");
    expect(content).toContain("## Steps");
    expect(content).toContain("Follow up on research");
  });

  it("listPlanFolders returns folders in plan dir", () => {
    const planDir = path.join(TEST_PROJECT_ROOT, "plan");
    fs.mkdirSync(path.join(planDir, "plan00"), { recursive: true });
    fs.mkdirSync(path.join(planDir, "plan01"), { recursive: true });
    fs.writeFileSync(path.join(planDir, "plan00", "plan.md"), "# Plan 00");

    const folders = planService.listPlanFolders(TEST_PROJECT_ROOT);
    expect(folders).toHaveLength(2);
    expect(folders[0].name).toBe("plan00");
    expect(folders[0].files).toContain("plan.md");
    expect(folders[1].name).toBe("plan01");
    expect(folders[1].files).toHaveLength(0);
  });
});

// ===================== FULL WORKFLOW TEST =====================

describe("Full plan workflow (notes linked via plan_notes)", () => {
  it("create plan with linked notes -> add steps -> insert to project", () => {
    // 1. Create notes (dormant project_id/status columns are preserved per N5 spec)
    const n1 = noteService.create("Design the API", userId, projectId, "API Design");
    const n2 = noteService.create("Setup database schema", userId, projectId, "DB Schema");
    noteService.create("Unrelated note", userId, projectId);

    expect(noteService.list(projectId, "open")).toHaveLength(3);

    // 2. Create plan and link notes directly (promotion path removed in N5)
    const plan0 = planService.create(projectId, "Sprint 1 Plan", null, userId);
    db.prepare("INSERT INTO plan_notes (plan_id, note_id) VALUES (?, ?)").run(plan0.id, n1.id);
    db.prepare("INSERT INTO plan_notes (plan_id, note_id) VALUES (?, ?)").run(plan0.id, n2.id);
    const planId = plan0.id;

    // 3. Add steps to the plan
    planService.addStep(planId, "Implement REST endpoints");
    planService.addStep(planId, "Write migration scripts");
    planService.addStep(planId, "Integration tests");

    // Verify plan has everything
    const plan = planService.getById(planId);
    expect(plan!.steps).toHaveLength(3);
    expect(plan!.note_ids).toHaveLength(2);
    expect(plan!.status).toBe("draft");

    // Plan should appear in active plans
    const activePlans = planService.list(projectId).filter(p => p.status !== "completed");
    expect(activePlans).toHaveLength(1);

    // 4. Insert plan to project filesystem
    const insertResult = planService.insertToProject(planId, TEST_PROJECT_ROOT, "sprint-1", true, userId);
    expect(insertResult).not.toBeNull();
    expect(insertResult!.path).toBe("plan/sprint-1/plan.md");

    // Plan should now be completed
    const completedPlan = planService.getById(planId);
    expect(completedPlan!.status).toBe("completed");

    // No more active plans
    const remainingActive = planService.list(projectId).filter(p => p.status !== "completed");
    expect(remainingActive).toHaveLength(0);

    // Completed plans should show up
    const completedPlans = planService.list(projectId, "completed");
    expect(completedPlans).toHaveLength(1);

    // File on disk should have all content
    const mdContent = fs.readFileSync(
      path.join(TEST_PROJECT_ROOT, "plan", "sprint-1", "plan.md"),
      "utf-8"
    );
    expect(mdContent).toContain("# Sprint 1 Plan");
    expect(mdContent).toContain("API Design");
    expect(mdContent).toContain("Design the API");
    expect(mdContent).toContain("DB Schema");
    expect(mdContent).toContain("Implement REST endpoints");
  });
});
