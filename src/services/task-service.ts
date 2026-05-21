import { DatabaseService } from "../db/database.js";
import { AuditService } from "./audit-service.js";

export interface Task {
  id: number;
  plan_id: number;
  project_id: number;
  plan_step_id: number | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: string;
  assigned_to: string | null;
  tmux_session_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface TaskExecution {
  id: number;
  task_id: number;
  executor: string;
  tmux_session_id: number | null;
  status: string;
  output_summary: string | null;
  error_details: string | null;
  started_at: string;
  ended_at: string | null;
}

export class TaskService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  listByProject(projectId: number, status?: string): Task[] {
    let sql = "SELECT * FROM tasks WHERE project_id = ?";
    const params: unknown[] = [projectId];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC";
    return this.db.prepare(sql).all(...params) as Task[];
  }

  listByPlan(planId: number): Task[] {
    return this.db
      .prepare("SELECT * FROM tasks WHERE plan_id = ? ORDER BY created_at")
      .all(planId) as Task[];
  }

  getById(id: number): Task | null {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | null;
  }

  create(params: {
    planId: number;
    projectId: number;
    planStepId?: number;
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    assignedTo?: string;
    tmuxSessionId?: number;
  }): Task {
    const result = this.db
      .prepare(
        `INSERT INTO tasks (plan_id, project_id, plan_step_id, title, description, acceptance_criteria, assigned_to, tmux_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(
        params.planId,
        params.projectId,
        params.planStepId || null,
        params.title,
        params.description || null,
        params.acceptanceCriteria || null,
        params.assignedTo || null,
        params.tmuxSessionId || null
      ) as Task;

    this.auditService.log({
      actionType: "task_create",
      resourceType: "task",
      resourceId: String(result.id),
      details: { plan_id: params.planId, title: params.title, assigned_to: params.assignedTo }
    });

    return result;
  }

  update(
    id: number,
    updates: {
      title?: string;
      description?: string | null;
      acceptance_criteria?: string | null;
      status?: string;
      assigned_to?: string | null;
      tmux_session_id?: number | null;
    },
    userId?: number
  ): Task | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const title = updates.title ?? existing.title;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const acceptance_criteria =
      updates.acceptance_criteria !== undefined ? updates.acceptance_criteria : existing.acceptance_criteria;
    const status = updates.status ?? existing.status;
    const assigned_to = updates.assigned_to !== undefined ? updates.assigned_to : existing.assigned_to;
    const tmux_session_id =
      updates.tmux_session_id !== undefined ? updates.tmux_session_id : existing.tmux_session_id;

    this.db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, acceptance_criteria = ?, status = ?,
         assigned_to = ?, tmux_session_id = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(title, description, acceptance_criteria, status, assigned_to, tmux_session_id, id);

    this.auditService.log({
      userId,
      actionType: "task_update",
      resourceType: "task",
      resourceId: String(id),
      details: updates
    });

    return this.getById(id);
  }

  startExecution(taskId: number, executor: string, tmuxSessionId?: number): TaskExecution {
    // Update task status
    this.db
      .prepare("UPDATE tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?")
      .run(taskId);

    const execution = this.db
      .prepare(
        `INSERT INTO task_executions (task_id, executor, tmux_session_id, status)
         VALUES (?, ?, ?, 'running') RETURNING *`
      )
      .get(taskId, executor, tmuxSessionId || null) as TaskExecution;

    this.auditService.log({
      agentName: executor !== "operator" ? executor : undefined,
      actionType: "task_execution_start",
      resourceType: "task",
      resourceId: String(taskId),
      details: { execution_id: execution.id, executor }
    });

    return execution;
  }

  completeExecution(
    executionId: number,
    status: "completed" | "failed",
    outputSummary?: string,
    errorDetails?: string
  ): TaskExecution | null {
    const existing = this.db
      .prepare("SELECT * FROM task_executions WHERE id = ?")
      .get(executionId) as TaskExecution | null;

    if (!existing) return null;

    this.db
      .prepare(
        "UPDATE task_executions SET status = ?, output_summary = ?, error_details = ?, ended_at = datetime('now') WHERE id = ?"
      )
      .run(status, outputSummary || null, errorDetails || null, executionId);

    // Update task status
    const taskStatus = status === "completed" ? "completed" : "failed";
    this.db
      .prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(taskStatus, existing.task_id);

    return this.db
      .prepare("SELECT * FROM task_executions WHERE id = ?")
      .get(executionId) as TaskExecution;
  }

  getExecutions(taskId: number): TaskExecution[] {
    return this.db
      .prepare("SELECT * FROM task_executions WHERE task_id = ? ORDER BY started_at DESC")
      .all(taskId) as TaskExecution[];
  }
}
