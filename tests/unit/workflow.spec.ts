import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { NoteService } from "../../src/services/note-service.js";
import { PlanService } from "../../src/services/plan-service.js";
import { TaskService } from "../../src/services/task-service.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-workflow.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("Notes → Plans → Tasks workflow", () => {
  let db: DatabaseService;
  let noteService: NoteService;
  let planService: PlanService;
  let taskService: TaskService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111);
    db.prepare("INSERT INTO projects (directory_name) VALUES ('testproj')").run();

    const audit = new AuditService(db);
    noteService = new NoteService(db, audit);
    planService = new PlanService(db, audit);
    taskService = new TaskService(db, audit);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("creates a note", () => {
    const note = noteService.create("Fix auth bug", 1, 1, "Auth Bug");
    expect(note.body).toBe("Fix auth bug");
    expect(note.status).toBe("open");
  });

  it("promotes note to plan", () => {
    const note = noteService.create("Fix auth bug", 1, 1);
    const result = noteService.promote(note.id, "Auth Fix Plan", 1);

    expect(result).not.toBeNull();
    expect(result!.planId).toBeGreaterThan(0);

    // Note status should be promoted
    const updatedNote = noteService.getById(note.id);
    expect(updatedNote!.status).toBe("promoted");

    // Plan should exist with note's body as description
    const plan = planService.getById(result!.planId);
    expect(plan!.title).toBe("Auth Fix Plan");
    expect(plan!.note_ids).toContain(note.id);
  });

  it("cannot promote already promoted note", () => {
    const note = noteService.create("Bug", 1, 1);
    noteService.promote(note.id, "Plan 1", 1);
    const second = noteService.promote(note.id, "Plan 2", 1);
    expect(second).toBeNull();
  });

  it("adds steps to plan", () => {
    const plan = planService.create(1, "Test Plan", null, 1);
    planService.addStep(plan.id, "Step 1: Investigate");
    planService.addStep(plan.id, "Step 2: Fix");
    planService.addStep(plan.id, "Step 3: Test");

    const full = planService.getById(plan.id);
    expect(full!.steps.length).toBe(3);
    expect(full!.steps[0].step_order).toBe(1);
    expect(full!.steps[2].step_order).toBe(3);
  });

  it("creates tasks from plan and tracks execution", () => {
    const plan = planService.create(1, "Test Plan", null, 1);
    const step = planService.addStep(plan.id, "Fix the thing");

    const task = taskService.create({
      planId: plan.id,
      projectId: 1,
      planStepId: step.id,
      title: "Fix auth module",
      assignedTo: "claude"
    });

    expect(task.status).toBe("pending");
    expect(task.assigned_to).toBe("claude");

    // Start execution
    const exec = taskService.startExecution(task.id, "claude");
    expect(exec.status).toBe("running");

    // Complete execution
    const completed = taskService.completeExecution(exec.id, "completed", "Fixed the bug");
    expect(completed!.status).toBe("completed");

    // Task should be completed
    const updatedTask = taskService.getById(task.id);
    expect(updatedTask!.status).toBe("completed");
  });

  it("handles failed execution", () => {
    const plan = planService.create(1, "Plan", null, 1);
    const task = taskService.create({
      planId: plan.id,
      projectId: 1,
      title: "Failing task"
    });

    const exec = taskService.startExecution(task.id, "codex");
    taskService.completeExecution(exec.id, "failed", null, "Timeout exceeded");

    const updatedTask = taskService.getById(task.id);
    expect(updatedTask!.status).toBe("failed");

    const executions = taskService.getExecutions(task.id);
    expect(executions[0].error_details).toBe("Timeout exceeded");
  });
});
