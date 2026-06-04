import { DatabaseService } from "../db/database.js";
import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  OvermindChildSessionStatus,
  OvermindParentStatus,
  CreateOvermindProjectInput,
  OvermindProject,
  UpdateOvermindProjectInput,
  OvermindTask,
  OvermindTaskHistoryEntry,
  OvermindTaskLogEntry,
  OvermindWorkflow,
  OvermindWorkflowStatus,
  RunSummary,
  UpdateOvermindWorkflowInput
} from "./overmind/types.js";
import {
  sanitizeCurrentTask,
  sanitizeTaskList
} from "./overmind/sanitize.js";

// Types live in ./overmind/types.ts (B7). Re-exported here for public-surface
// stability per og-requirements R2.5.
export type {
  OvermindChildSessionStatus,
  OvermindChildStatus,
  OvermindParentStatus,
  CreateOvermindProjectInput,
  OvermindProject,
  UpdateOvermindProjectInput,
  OvermindTask,
  OvermindTaskHistoryEntry,
  OvermindTaskLogEntry,
  OvermindTaskState,
  OvermindWorkflow,
  OvermindWorkflowStatus,
  RunSummary,
  SparkHealth,
  SparkHealthState,
  UpdateOvermindWorkflowInput
} from "./overmind/types.js";

// Sanitation helpers live in ./overmind/sanitize.ts (B7).
export { isTrashTaskLabel, sanitizeTaskList, sanitizeCurrentTask } from "./overmind/sanitize.js";

interface OvermindWorkflowRow {
  id: number;
  project_id: number | null;
  label: string;
  display_name: string | null;
  coordinator_session: string;
  child_sessions: string;
  child_roles: string;
  run_dir: string;
  status: OvermindWorkflowStatus;
  current_task: string | null;
  tasks: string;
  pending_decision: string | null;
  active_session: string | null;
  active_role: "parent" | "child" | null;
  ended_at: string | null;
  task_log: string;
  last_pane_hash: string | null;
  last_activity_at: string;
  stuck_since: string | null;
  nudge_count: number;
  tier: number;
  last_notified_transition: string | null;
  run_started_at: string | null;
  accumulated_ms: number;
  completion_check: string | null;
  parent_status: OvermindParentStatus | null;
  child_statuses: string;
  info_request: string | null;
  info_check: string | null;
  monitoring_paused: number;
  paused_at: string | null;
  paused_by: string | null;
  last_parent_update_at: string | null;
  evidence_idle_threshold_override_minutes: number | null;
  created_at: string;
  updated_at: string;
}

interface OvermindTaskHistoryRow {
  id: number;
  coordinator_session: string;
  name: string;
  at: string;
  current_task: string | null;
  done: number;
  total: number;
}

interface OvermindProjectRow {
  id: number;
  slug: string;
  app_path: string;
  parent_session: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface ActiveRunRow extends OvermindWorkflowRow {
  project_slug: string;
  project_parent_session: string;
}

export interface OvermindWorkflowLookup {
  workflow_id?: number | string | null;
  run_dir?: string | null;
  session?: string | null;
}

export interface OvermindProjectRunDirMatch {
  project: OvermindProject | null;
  run_dir: string;
  searched_up_to: string;
}

export interface OvermindActiveRun {
  workflow: OvermindWorkflow;
  project_slug: string;
  parent_session: string;
}

export class OvermindService {
  constructor(private readonly db: DatabaseService) {}

  createProject(input: CreateOvermindProjectInput): OvermindProject {
    const row = this.db
      .prepare(
        `INSERT INTO overmind_projects (
          slug,
          app_path,
          parent_session,
          notes,
          created_by
        ) VALUES (?, ?, ?, ?, 'JROM')
        RETURNING *`
      )
      .get(
        input.slug,
        input.app_path,
        input.parent_session,
        input.notes ?? null
      ) as OvermindProjectRow;

    return this.mapProjectRow(row);
  }

  getProjectBySlug(slug: string): OvermindProject | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_projects WHERE slug = ?")
      .get(slug) as OvermindProjectRow | undefined;
    return row ? this.mapProjectRow(row) : null;
  }

  getProjectByAppPath(appPath: string): OvermindProject | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_projects WHERE app_path = ?")
      .get(appPath) as OvermindProjectRow | undefined;
    return row ? this.mapProjectRow(row) : null;
  }

  listProjects(): OvermindProject[] {
    const rows = this.db
      .prepare("SELECT * FROM overmind_projects ORDER BY slug ASC, id ASC")
      .all() as OvermindProjectRow[];
    return rows.map((row) => this.mapProjectRow(row));
  }

  activeRunsCountForProjectSlug(slug: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM overmind_workflows w
         JOIN overmind_projects p ON p.id = w.project_id
         WHERE p.slug = ?
           AND w.status NOT IN ('completed', 'failed', 'paused')`
      )
      .get(slug) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  latestParentStatusForProjectSlug(slug: string): OvermindParentStatus | null {
    const row = this.db
      .prepare(
        `SELECT w.parent_status AS parent_status
         FROM overmind_workflows w
         JOIN overmind_projects p ON p.id = w.project_id
         WHERE p.slug = ?
         ORDER BY datetime(w.updated_at) DESC, w.id DESC
         LIMIT 1`
      )
      .get(slug) as { parent_status: OvermindParentStatus | null } | undefined;
    return row?.parent_status ?? null;
  }

  updateProjectBySlug(slug: string, input: UpdateOvermindProjectInput): OvermindProject | null {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.parent_session !== undefined) {
      assignments.push("parent_session = ?");
      params.push(input.parent_session);
    }
    if (input.notes !== undefined) {
      assignments.push("notes = ?");
      params.push(input.notes);
    }
    if (assignments.length === 0) {
      return this.getProjectBySlug(slug);
    }

    assignments.push("updated_at = datetime('now')");
    const row = this.db
      .prepare(
        `UPDATE overmind_projects
         SET ${assignments.join(", ")}
         WHERE slug = ?
         RETURNING *`
      )
      .get(...params, slug) as OvermindProjectRow | undefined;
    return row ? this.mapProjectRow(row) : null;
  }

  deleteProjectBySlug(slug: string): boolean {
    const project = this.getProjectBySlug(slug);
    if (!project) return false;

    this.db
      .prepare("UPDATE overmind_workflows SET project_id = NULL WHERE project_id = ?")
      .run(project.id);
    const result = this.db
      .prepare("DELETE FROM overmind_projects WHERE slug = ?")
      .run(slug);
    return result.changes > 0;
  }

  async findProjectForRunDir(runDir: string): Promise<OvermindProjectRunDirMatch> {
    const canonicalRunDir = await this.canonicalizeRunDir(runDir);
    const root = path.parse(canonicalRunDir).root;
    const projectsByPath = new Map<string, OvermindProject>();

    for (const project of this.listProjects()) {
      projectsByPath.set(await this.canonicalizeRunDir(project.app_path), project);
    }

    let current = canonicalRunDir;
    while (true) {
      const project = projectsByPath.get(current);
      if (project) {
        return { project, run_dir: canonicalRunDir, searched_up_to: current };
      }
      if (current === root) {
        return { project: null, run_dir: canonicalRunDir, searched_up_to: root };
      }
      current = path.dirname(current);
    }
  }

  registerAttached(input: {
    project_id: number;
    label: string;
    run_dir: string;
    coordinator_session?: string | null;
    current_task?: string | null;
    tasks?: OvermindTask[];
  }): OvermindWorkflow {
    let tasks = sanitizeTaskList(input.tasks);
    const existing = this.getByProjectRunDir(input.project_id, input.run_dir);
    // coordinator_session is DERIVED server-side from the project's parent_session
    // (the attach shape forbids the caller supplying it). Without this it stayed NULL,
    // which the watcher + spark daemon read as "coord session dead" → false CRASHED.
    const coordinatorSession = input.coordinator_session ?? existing?.coordinator_session ?? null;
    const currentTask = input.current_task !== undefined
      ? sanitizeCurrentTask(input.current_task)
      : existing?.current_task ?? null;

    if (existing?.tasks?.length && tasks.length > 0) {
      const prevById = new Map(existing.tasks.map(t => [t.id, t]));
      const overlap = tasks.some(t => prevById.has(t.id));
      if (overlap) {
        tasks = tasks.map(t =>
          t.state !== "done" && prevById.get(t.id)?.state === "done"
            ? { ...t, state: "done" as const }
            : t
        );
      }
    }

    const effectiveTasks = tasks.length > 0 ? tasks : existing?.tasks ?? [];
    const now = this.isoNow();
    const endedAt = this.computeEndedAt(effectiveTasks, "active", existing?.ended_at ?? null, now);
    const row = (existing
      ? this.db
          .prepare(
            `UPDATE overmind_workflows
             SET label = ?,
                 coordinator_session = ?,
                 project_id = ?,
                 run_dir = ?,
                 status = 'active',
                 current_task = ?,
                 tasks = ?,
                 pending_decision = NULL,
                 active_session = NULL,
                 active_role = NULL,
                 ended_at = ?,
                 stuck_since = NULL,
                 nudge_count = 0,
                 tier = 0,
                 last_notified_transition = NULL,
                 completion_check = NULL,
                 run_started_at = COALESCE(run_started_at, ?),
                 updated_at = ?
             WHERE id = ?
             RETURNING *`
          )
          .get(
            input.label,
            coordinatorSession,
            input.project_id,
            input.run_dir,
            currentTask,
            JSON.stringify(effectiveTasks),
            endedAt,
            now,
            now,
            existing.id
          )
      : this.db
          .prepare(
            `INSERT INTO overmind_workflows (
              project_id,
              label,
              coordinator_session,
              child_sessions,
              child_roles,
              run_dir,
              status,
              current_task,
              tasks,
              pending_decision,
              active_session,
              active_role,
              ended_at,
              task_log,
              stuck_since,
              nudge_count,
              tier,
              last_notified_transition,
              run_started_at,
              accumulated_ms,
              updated_at
            ) VALUES (?, ?, ?, '[]', '[]', ?, 'active', ?, ?, NULL, NULL, NULL, ?, '[]', NULL, 0, 0, NULL, ?, 0, ?)
            RETURNING *`
          )
          .get(
            input.project_id,
            input.label,
            coordinatorSession,
            input.run_dir,
            currentTask,
            JSON.stringify(effectiveTasks),
            endedAt,
            now,
            now
          )) as OvermindWorkflowRow;

    this.touchParentUpdate(row.id);
    const registered = this.get(row.id);
    if (!registered) {
      throw new Error(`Failed to load workflow ${row.id} after attached register`);
    }
    return registered;
  }

  list(status?: OvermindWorkflowStatus): OvermindWorkflow[] {
    const rows = status
      ? this.db
          .prepare("SELECT * FROM overmind_workflows WHERE status = ? ORDER BY updated_at DESC, id DESC")
          .all(status)
      : this.db
          .prepare("SELECT * FROM overmind_workflows ORDER BY updated_at DESC, id DESC")
          .all();

    return (rows as OvermindWorkflowRow[]).map((row) => this.mapRow(row));
  }

  get(id: number): OvermindWorkflow | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_workflows WHERE id = ?")
      .get(id) as OvermindWorkflowRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getBySession(coordinatorSession: string): OvermindWorkflow | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_workflows WHERE coordinator_session = ?")
      .get(coordinatorSession) as OvermindWorkflowRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByRunDir(runDir: string): OvermindWorkflow | null {
    const row = this.db
      .prepare("SELECT * FROM overmind_workflows WHERE run_dir = ? ORDER BY updated_at DESC, id DESC LIMIT 1")
      .get(runDir) as OvermindWorkflowRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  getByProjectRunDir(projectId: number, runDir: string): OvermindWorkflow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM overmind_workflows
         WHERE project_id = ? AND run_dir = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`
      )
      .get(projectId, runDir) as OvermindWorkflowRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  async findWorkflow(lookup: OvermindWorkflowLookup): Promise<OvermindWorkflow | null> {
    const workflowId = this.normalizeWorkflowId(lookup.workflow_id);
    if (workflowId !== null) {
      const byId = this.get(workflowId);
      if (byId) return byId;
    }

    const runDir = typeof lookup.run_dir === "string" ? lookup.run_dir.trim() : "";
    if (runDir) {
      const byRunDir = this.getByRunDir(runDir);
      if (byRunDir) return byRunDir;

      const byCanonicalRunDir = await this.findByCanonicalRunDir(runDir);
      if (byCanonicalRunDir) return byCanonicalRunDir;
    }

    const session = typeof lookup.session === "string" ? lookup.session.trim() : "";
    if (session) {
      return this.getBySession(session);
    }

    return null;
  }

  private async findByCanonicalRunDir(runDir: string): Promise<OvermindWorkflow | null> {
    const incomingCanonical = await this.canonicalizeRunDir(runDir);
    const exactCanonical = this.getByRunDir(incomingCanonical);
    if (exactCanonical) return exactCanonical;

    const rows = this.db
      .prepare("SELECT * FROM overmind_workflows ORDER BY updated_at DESC, id DESC")
      .all() as OvermindWorkflowRow[];
    for (const row of rows) {
      const workflowCanonical = await this.canonicalizeRunDir(row.run_dir);
      if (workflowCanonical === incomingCanonical) {
        return this.mapRow(row);
      }
    }
    return null;
  }

  getParentSessionForWorkflow(id: number): string | null {
    const row = this.db
      .prepare(
        `SELECT p.parent_session AS parent_session
         FROM overmind_workflows w
         JOIN overmind_projects p ON p.id = w.project_id
         WHERE w.id = ?`
      )
      .get(id) as { parent_session: string } | undefined;
    return row?.parent_session ?? null;
  }

  listActiveRunsForDaemon(): OvermindActiveRun[] {
    const rows = this.db
      .prepare(
        `SELECT
           w.*,
           p.slug AS project_slug,
           p.parent_session AS project_parent_session
         FROM overmind_workflows w
         JOIN overmind_projects p ON p.id = w.project_id
         WHERE w.status NOT IN ('completed', 'failed', 'paused')
         ORDER BY datetime(w.created_at) ASC, w.id ASC`
      )
      .all() as ActiveRunRow[];

    return rows.map((row) => {
      const { project_slug, project_parent_session, ...workflowRow } = row;
      return {
        workflow: this.mapRow(workflowRow),
        project_slug,
        parent_session: project_parent_session
      };
    });
  }

  listHistory(coordinatorSession?: string): OvermindTaskHistoryEntry[] {
    const rows = coordinatorSession
      ? this.db
          .prepare(
            `SELECT
              h.id,
              h.coordinator_session,
              COALESCE(w.display_name, w.label, h.name) AS name,
              h.at,
              h.current_task,
              h.done,
              h.total
            FROM overmind_task_history h
            LEFT JOIN overmind_workflows w
              ON w.coordinator_session = h.coordinator_session
            WHERE h.coordinator_session = ?
            ORDER BY h.at DESC, h.id DESC`
          )
          .all(coordinatorSession)
      : this.db
          .prepare(
            `SELECT
              h.id,
              h.coordinator_session,
              COALESCE(w.display_name, w.label, h.name) AS name,
              h.at,
              h.current_task,
              h.done,
              h.total
            FROM overmind_task_history h
            LEFT JOIN overmind_workflows w
              ON w.coordinator_session = h.coordinator_session
            ORDER BY h.at DESC, h.id DESC`
          )
          .all();
    return (rows as OvermindTaskHistoryRow[]).map((row) => ({ ...row }));
  }

  listRuns(): RunSummary[] {
    // History tab shows EVERY workflow (active + terminal). JROM 2026-05-24:
    // "the history should hold all the projects or workflow we have and only
    // gets updated when a new tasklist is done so it gets updated". Ordered
    // by most-recent activity — last_parent_update_at when present (it's the
    // F1 signal "parent talked to me last"), else ended_at, else run_started_at.
    const rows = this.db
      .prepare(
        `SELECT id, label, display_name, coordinator_session, status,
                run_started_at, ended_at, last_parent_update_at, tasks
        FROM overmind_workflows
        ORDER BY
          COALESCE(last_parent_update_at, ended_at, run_started_at, created_at) DESC,
          id DESC`
      )
      .all() as Array<{
        id: number;
        label: string;
        display_name: string | null;
        coordinator_session: string;
        status: OvermindWorkflowStatus;
        run_started_at: string | null;
        ended_at: string | null;
        last_parent_update_at: string | null;
        tasks: string;
      }>;

    return rows.map((row) => {
      const tasks = this.parseJsonArray<OvermindTask>(row.tasks);
      return {
        id: row.id,
        label: row.label,
        display_name: row.display_name,
        coordinator_session: row.coordinator_session,
        status: row.status,
        run_started_at: row.run_started_at,
        ended_at: row.ended_at,
        last_parent_update_at: row.last_parent_update_at,
        total_tasks: tasks.length,
        done_tasks: this.countDoneTasks(tasks)
      };
    });
  }

  update(id: number, fields: UpdateOvermindWorkflowInput): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;

    const next = {
      label: fields.label ?? existing.label,
      coordinator_session: fields.coordinator_session ?? existing.coordinator_session,
      child_sessions: fields.child_sessions ?? existing.child_sessions,
      run_dir: fields.run_dir ?? existing.run_dir,
      status: fields.status ?? existing.status,
      current_task: fields.current_task !== undefined ? fields.current_task : existing.current_task,
      tasks: fields.tasks ?? existing.tasks,
      pending_decision: fields.pending_decision !== undefined ? fields.pending_decision : existing.pending_decision,
      active_session: fields.active_session !== undefined ? fields.active_session : existing.active_session,
      active_role: fields.active_role !== undefined ? fields.active_role : existing.active_role,
      last_pane_hash: fields.last_pane_hash !== undefined ? fields.last_pane_hash : existing.last_pane_hash,
      last_activity_at: fields.last_activity_at !== undefined ? fields.last_activity_at : existing.last_activity_at,
      stuck_since: fields.stuck_since !== undefined ? fields.stuck_since : existing.stuck_since,
      nudge_count: fields.nudge_count ?? existing.nudge_count,
      tier: fields.tier ?? existing.tier,
      last_notified_transition: fields.last_notified_transition !== undefined
        ? fields.last_notified_transition
        : existing.last_notified_transition,
      completion_check: fields.completion_check !== undefined
        ? fields.completion_check
        : existing.completion_check,
      parent_status: fields.parent_status !== undefined ? fields.parent_status : existing.parent_status,
      child_statuses: fields.child_statuses ?? existing.child_statuses,
      info_request: fields.info_request !== undefined ? fields.info_request : existing.info_request,
      info_check: fields.info_check !== undefined ? fields.info_check : existing.info_check
    };

    this.db
      .prepare(
        `UPDATE overmind_workflows
        SET label = ?,
            coordinator_session = ?,
            child_sessions = ?,
            run_dir = ?,
            status = ?,
            current_task = ?,
            tasks = ?,
            pending_decision = ?,
            active_session = ?,
            active_role = ?,
            last_pane_hash = ?,
            last_activity_at = ?,
            stuck_since = ?,
            nudge_count = ?,
            tier = ?,
            last_notified_transition = ?,
            completion_check = ?,
            parent_status = ?,
            child_statuses = ?,
            info_request = ?,
            info_check = ?,
            updated_at = datetime('now')
        WHERE id = ?`
      )
      .run(
        next.label,
        next.coordinator_session,
        JSON.stringify(next.child_sessions),
        next.run_dir,
        next.status,
        next.current_task,
        JSON.stringify(next.tasks),
        next.pending_decision,
        next.active_session,
        next.active_role,
        next.last_pane_hash,
        next.last_activity_at,
        next.stuck_since,
        next.nudge_count,
        next.tier,
        next.last_notified_transition,
        next.completion_check,
        next.parent_status,
        JSON.stringify(next.child_statuses),
        next.info_request,
        next.info_check,
        id
      );

    return this.get(id);
  }

  markNotificationTransition(id: number, transition: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE overmind_workflows
        SET last_notified_transition = ?, updated_at = datetime('now')
        WHERE id = ?
          AND (last_notified_transition IS NULL OR last_notified_transition != ?)`
      )
      .run(transition, id, transition);
    return result.changes > 0;
  }

  // JROM-only field — only this method may write display_name; only the JWT/owner-guarded
  // POST /api/overmind/workflows/:id/name route may call it. Do not add display_name to
  // register/update/setStatus/setTasks SQL.
  setDisplayName(id: number, name: string | null): OvermindWorkflow | null {
    const normalized = name === null ? null : name.trim();
    const displayName = normalized ? normalized : null;
    const result = this.db
      .prepare("UPDATE overmind_workflows SET display_name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(displayName, id);
    if (result.changes === 0) return null;
    return this.get(id);
  }

  // JROM-initiated monitoring pause: suppresses all overmind interrupts (nudges,
  // completeness requests, brain consults, notifications) for this workflow without
  // changing its status, so the card stays visible. `by` records the initiator for awareness.
  setMonitoringPaused(id: number, paused: boolean, by: string | null): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE overmind_workflows
        SET monitoring_paused = ?,
            paused_at = ?,
            paused_by = ?,
            nudge_count = CASE WHEN ? = 1 THEN 0 ELSE nudge_count END,
            tier = CASE WHEN ? = 1 THEN 0 ELSE tier END,
            updated_at = datetime('now')
        WHERE id = ?`
      )
      .run(
        paused ? 1 : 0,
        paused ? this.isoNow() : null,
        paused ? by : null,
        paused ? 1 : 0,
        paused ? 1 : 0,
        id
      );
    this.touchParentUpdate(id);
    return this.get(id);
  }

  setStatus(
    id: number,
    status: OvermindWorkflowStatus,
    options?: { touchParentUpdate?: boolean }
  ): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    const endedAt = this.computeEndedAt(existing.tasks, status, existing.ended_at);

    this.db
      .prepare("UPDATE overmind_workflows SET status = ?, ended_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, endedAt, id);
    if (options?.touchParentUpdate === true) {
      this.touchParentUpdate(id);
    }
    return this.get(id);
  }

  /**
   * Update the workflow's task list and current_task. `source` audits whether
   * the change came from a parent /api/overmind/tasks call (default) or from
   * overmind's own evidence-derived auto-promote (JROM 2026-05-24 fix).
   */
  setTasks(
    id: number,
    currentTask: string | null,
    tasks: OvermindTask[],
    source: "parent" | "evidence-derived" = "parent"
  ): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    // Same defensive filter as register — strips markdown table chrome ("| # | Batch | …"
    // and "|---|---|") and empty labels before persisting. Callers that accidentally
    // pipe a queue.md through line-by-line stop polluting the dashboard.
    tasks = sanitizeTaskList(tasks);
    currentTask = sanitizeCurrentTask(currentTask);

    // Preserve evidence-promoted "done" states — never let a coordinator sync
    // overwrite a task back from done to pending/processing.
    if (existing.tasks?.length) {
      const prevById = new Map(existing.tasks.map(t => [t.id, t]));
      tasks = tasks.map(t =>
        t.state !== "done" && prevById.get(t.id)?.state === "done"
          ? { ...t, state: "done" as const }
          : t
      );
    }

    const now = this.isoNow();
    tasks = this.withActualElapsedMinutes(existing.tasks, tasks, now);
    const doneCount = this.countDoneTasks(tasks);
    const existingDoneCount = this.countDoneTasks(existing.tasks);
    const shouldLog = currentTask !== existing.current_task || doneCount !== existingDoneCount;
    const taskLog = shouldLog
      ? [
          ...existing.task_log,
          {
            at: now,
            current_task: currentTask,
            done: doneCount,
            total: tasks.length,
            note: this.taskLogNote(existing.current_task, currentTask, existingDoneCount, doneCount),
            source
          }
        ].slice(-50)
      : existing.task_log;
    const endedAt = this.computeEndedAt(tasks, existing.status, existing.ended_at, now);

    const tx = this.db.raw.transaction(() => {
      this.db
        .prepare("UPDATE overmind_workflows SET current_task = ?, tasks = ?, ended_at = ?, task_log = ?, updated_at = datetime('now') WHERE id = ?")
        .run(currentTask, JSON.stringify(tasks), endedAt, JSON.stringify(taskLog), id);

      if (shouldLog) {
        this.db
          .prepare(
            `INSERT INTO overmind_task_history (
              coordinator_session,
              name,
              at,
              current_task,
              done,
              total
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            existing.coordinator_session || `workflow:${existing.id}`,
            this.workflowName(existing),
            now,
            currentTask,
            doneCount,
            tasks.length
          );
      }
    });
    tx();
    this.touchParentUpdate(id);
    return this.get(id);
  }

  setChildren(id: number, childSessions: string[], childRoles: string[]): OvermindWorkflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE overmind_workflows
         SET child_sessions = ?,
             child_roles = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(JSON.stringify(childSessions), JSON.stringify(childRoles), id);
    this.touchParentUpdate(id);
    return this.get(id);
  }

  setEvidenceIdleThresholdOverride(id: number, minutes: number | null): OvermindWorkflow | null {
    if (minutes !== null) {
      if (
        !Number.isInteger(minutes) ||
        minutes < 5 ||
        minutes > 240 ||
        minutes % 5 !== 0
      ) {
        throw new Error("evidence_idle_threshold_override_minutes must be null or an integer multiple of 5 between 5 and 240");
      }
    }
    const result = this.db
      .prepare(
        "UPDATE overmind_workflows SET evidence_idle_threshold_override_minutes = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(minutes, id);
    if (result.changes === 0) return null;
    return this.get(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM overmind_workflows WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Owner cleanup: removes a single task-history entry (one row in
   *  overmind_task_history). The workflow row itself is untouched. JROM 2026-05-24:
   *  "delete actual workflows on history or the tasks list themselves, so i can
   *  clean them up myself". Used by the JWT-owner DELETE /api/overmind/history/:id. */
  deleteHistoryEntry(id: number): boolean {
    const result = this.db.prepare("DELETE FROM overmind_task_history WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private mapRow(row: OvermindWorkflowRow): OvermindWorkflow {
    return {
      ...row,
      monitoring_paused: row.monitoring_paused === 1,
      child_sessions: this.parseJsonArray<string>(row.child_sessions),
      child_roles: this.parseJsonArray<string>(row.child_roles),
      tasks: this.parseJsonArray<OvermindTask>(row.tasks),
      task_log: this.parseJsonArray<OvermindTaskLogEntry>(row.task_log),
      child_statuses: this.parseJsonArray<OvermindChildSessionStatus>(row.child_statuses)
    };
  }

  private mapProjectRow(row: OvermindProjectRow): OvermindProject {
    return { ...row };
  }

  private parseJsonArray<T>(value: string): T[] {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  }

  private countDoneTasks(tasks: OvermindTask[]): number {
    return tasks.filter((task) => task.state === "done").length;
  }

  private workflowName(workflow: Pick<OvermindWorkflow, "id" | "display_name" | "label" | "run_dir">): string {
    return workflow.display_name || workflow.label || path.basename(workflow.run_dir) || `workflow:${workflow.id}`;
  }

  private normalizeWorkflowId(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined || value === "") return null;
    const workflowId = Number(value);
    return Number.isInteger(workflowId) && workflowId >= 1 ? workflowId : null;
  }

  private taskLogNote(previousTask: string | null, currentTask: string | null, previousDone: number, done: number): string {
    if (previousTask !== currentTask && previousDone !== done) return "current task and progress changed";
    if (previousTask !== currentTask) return "current task changed";
    return "progress changed";
  }

  private withActualElapsedMinutes(
    previousTasks: OvermindTask[],
    nextTasks: OvermindTask[],
    now: string
  ): OvermindTask[] {
    const previousById = new Map(previousTasks.map((task) => [task.id, task]));
    return nextTasks.map((task) => {
      const previous = previousById.get(task.id);
      const preservedActual = task.actual_min ?? previous?.actual_min ?? null;
      let startedAt = task.started_at ?? previous?.started_at ?? null;
      if (task.state === "processing" && previous?.state !== "processing" && !startedAt) {
        startedAt = now;
      }

      if (preservedActual !== null) {
        return { ...task, started_at: startedAt, actual_min: preservedActual };
      }
      if (previous?.state !== "processing" || task.state !== "done") {
        return { ...task, started_at: startedAt, actual_min: null };
      }

      if (!startedAt) return { ...task, started_at: null, actual_min: null };

      const startMs = Date.parse(startedAt);
      const doneMs = Date.parse(now);
      if (!Number.isFinite(startMs) || !Number.isFinite(doneMs) || doneMs < startMs) {
        return { ...task, started_at: startedAt, actual_min: null };
      }

      return { ...task, started_at: startedAt, actual_min: Math.max(0, Math.round((doneMs - startMs) / 60000)) };
    });
  }

  private computeEndedAt(
    tasks: OvermindTask[],
    status: OvermindWorkflowStatus,
    previousEndedAt: string | null,
    now = this.isoNow()
  ): string | null {
    if (tasks.some((task) => task.state !== "done")) return null;
    if ((tasks.length > 0 && tasks.every((task) => task.state === "done")) || status === "completed") {
      return previousEndedAt ?? now;
    }
    return previousEndedAt;
  }

  private async canonicalizeRunDir(runDir: string): Promise<string> {
    const resolved = path.resolve(runDir);
    try {
      return await realpath(resolved);
    } catch {
      return resolved;
    }
  }

  private touchParentUpdate(workflowId: number): void {
    this.db
      .prepare("UPDATE overmind_workflows SET last_parent_update_at = ? WHERE id = ?")
      .run(this.isoNow(), workflowId);
  }

  private isoNow(): string {
    return new Date().toISOString();
  }
}
