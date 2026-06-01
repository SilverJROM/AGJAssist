import fs from "node:fs";
import path from "node:path";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppConfig } from "../../config/config.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import {
  OvermindService,
  OvermindProject,
  OvermindTask,
  OvermindWorkflow,
  OvermindWorkflowStatus,
  RunSummary
} from "../../services/overmind-service.js";
import type { OvermindNotify } from "../../services/overmind-watcher.js";
import { buildDoneNotification } from "../../services/overmind-notifications.js";
import { OvermindStreamManager } from "../websocket/overmind-stream-manager.js";
import type { OvmSessionManager } from "../../services/ovm-session.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { NudgeStateService } from "../../services/nudge-state-service.js";

interface TokenBody {
  token?: string;
}

interface CreateProjectBody extends TokenBody {
  slug?: string;
  app_path?: string;
  parent_session?: string;
  notes?: string | null;
  created_by?: string;
}

interface UpdateProjectBody extends TokenBody {
  slug?: string;
  app_path?: string;
  parent_session?: string;
  notes?: string | null;
}

interface ProjectParams {
  slug: string;
}

interface SendBody {
  message?: string;
}

interface RegisterBody extends TokenBody {
  label?: string;
  parent_label?: string;
  parent_session?: string;
  project_slug?: string;
  session?: string;
  child_sessions?: string[];
  child_roles?: string[];
  run_dir?: string;
  current_task?: string | null;
  tasks?: OvermindTask[];
}

interface CompleteBody extends TokenBody {
  workflow_id?: number | string;
  run_dir?: string;
  session?: string;
}

interface TasksBody extends TokenBody {
  workflow_id?: number | string;
  run_dir?: string;
  session?: string;
  current_task?: string | null;
  tasks?: OvermindTask[];
}

interface ChildrenBody extends TokenBody {
  workflow_id?: number | string;
  run_dir?: string;
  session?: string;
  child_sessions?: string[];
  child_roles?: string[];
}

interface WorkflowParams {
  id: string;
}

interface RenameParams {
  id: string;
}

interface RenameBody {
  name?: string | null;
}

interface AskUpdateCooldownBody extends TokenBody {
  override_minutes?: number | null;
}

const REGISTER_CONFLICT_NUDGE_COOLDOWN_MS = 30 * 60 * 1000;
const PROJECT_MUTATION_FORBIDDEN = {
  error: "projects are JROM-managed; ask JROM to create via dashboard"
};

function buildProjectTreeConflictMessage(existing: OvermindWorkflow): string {
  return (
    `Overmind: a workflow for this project tree is already registered as ` +
    `'${existing.coordinator_session}' (id=${existing.id}). Please use that session name in your next ` +
    `POST /api/overmind/register, /tasks, /complete, and /pause calls — overmind tracks one workflow per project tree. ` +
    `Do NOT create new workflows for sub-phases of the same project.`
  );
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase();
  return normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized === "localhost";
}

function requireLoopbackAndToken(
  request: FastifyRequest<{ Body: TokenBody }>,
  reply: FastifyReply,
  expectedToken: string
): boolean {
  if (!isLoopbackAddress(request.ip)) {
    reply.code(403).send({ error: "Overmind lifecycle endpoints are localhost-only" });
    return false;
  }

  const headerToken = request.headers["x-overmind-token"];
  const token = request.body?.token || (Array.isArray(headerToken) ? headerToken[0] : headerToken);
  if (!token || token !== expectedToken) {
    reply.code(401).send({ error: "Missing or invalid overmind token" });
    return false;
  }

  return true;
}

function hasLoopbackOvermindCredential(
  request: FastifyRequest,
  expectedToken: string
): boolean {
  if (!isLoopbackAddress(request.ip)) return false;

  const headerToken = request.headers["x-overmind-token"];
  const body = request.body as TokenBody | undefined;
  const token = body?.token || (Array.isArray(headerToken) ? headerToken[0] : headerToken);
  return token === expectedToken;
}

function requireOwnerJwtForProjectMutation(
  request: FastifyRequest<{ Body?: TokenBody }>,
  reply: FastifyReply,
  authService: AuthService,
  expectedToken: string
): boolean {
  const forbidden = (): false => {
    reply.code(403).send(PROJECT_MUTATION_FORBIDDEN);
    return false;
  };

  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    const user = token ? authService.verifyToken(token) : null;
    if (user?.role === "owner") {
      request.sessionUser = user;
      return true;
    }
    if (user) return forbidden();
    if (hasLoopbackOvermindCredential(request, expectedToken)) return forbidden();

    reply.code(401).send({ error: "Invalid or expired token" });
    return false;
  }

  if (hasLoopbackOvermindCredential(request, expectedToken)) return forbidden();

  reply.code(401).send({ error: "Missing or invalid authorization header" });
  return false;
}

function requireProjectReadAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
  expectedToken: string
): boolean {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    const user = token ? authService.verifyToken(token) : null;
    if (user) {
      request.sessionUser = user;
      return true;
    }
    if (!hasLoopbackOvermindCredential(request, expectedToken)) {
      reply.code(401).send({ error: "Invalid or expired token" });
      return false;
    }
  }

  if (hasLoopbackOvermindCredential(request, expectedToken)) return true;

  reply.code(401).send({ error: "Missing or invalid authorization header" });
  return false;
}

function parseWorkflowId(id: string): number | null {
  const workflowId = Number(id);
  return Number.isInteger(workflowId) && workflowId >= 1 ? workflowId : null;
}

function hasWorkflowLookupKey(body: { workflow_id?: number | string; run_dir?: string; session?: string }): boolean {
  return body.workflow_id !== undefined && body.workflow_id !== null && `${body.workflow_id}`.trim() !== "" ||
    typeof body.run_dir === "string" && body.run_dir.trim() !== "" ||
    typeof body.session === "string" && body.session.trim() !== "";
}

// Best-effort JWT verification — returns the session user (owner role) when a
// valid owner-authed bearer token is present, null otherwise. Used by dual-auth
// routes that accept either JWT-owner (UI) or loopback+overmind-token (CLI).
async function tryAuthOwner(
  request: FastifyRequest,
  authService: AuthService
): Promise<{ id: number; role: "owner" | "viewer" } | null> {
  const header = request.headers.authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const user = authService.verifyToken(token);
    return user && user.role === "owner" ? { id: user.id, role: user.role } : null;
  } catch {
    return null;
  }
}

export function registerOvermindRoutes(
  app: FastifyInstance,
  config: AppConfig,
  authService: AuthService,
  overmindService: OvermindService,
  notify?: OvermindNotify,
  streamManager?: OvermindStreamManager,
  ovmSession?: OvmSessionManager,
  tmuxService?: TmuxService,
  nudgeState?: NudgeStateService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  const withActiveRunsCount = (project: OvermindProject) => ({
    ...project,
    active_runs_count: overmindService.activeRunsCountForProjectSlug(project.slug)
  });

  app.post<{ Body: CreateProjectBody }>(
    "/api/overmind/projects",
    async (request, reply) => {
      if (!requireOwnerJwtForProjectMutation(request, reply, authService, config.overmind.token)) return;

      const slug = typeof request.body?.slug === "string" ? request.body.slug.trim() : "";
      const appPath = typeof request.body?.app_path === "string" ? request.body.app_path.trim() : "";
      const parentSession = typeof request.body?.parent_session === "string" ? request.body.parent_session.trim() : "";
      const notes = typeof request.body?.notes === "string" ? request.body.notes : null;

      if (!slug) {
        return reply.code(400).send({ error: "'slug' must be a non-empty string" });
      }
      if (!appPath) {
        return reply.code(400).send({ error: "'app_path' must be a non-empty string" });
      }
      if (!parentSession) {
        return reply.code(400).send({ error: "'parent_session' must be a non-empty string" });
      }
      if (!path.isAbsolute(appPath)) {
        return reply.code(400).send({ error: "'app_path' must be an absolute path" });
      }
      if (!fs.existsSync(appPath)) {
        return reply.code(400).send({ error: "'app_path' must exist on disk" });
      }

      try {
        const project = overmindService.createProject({
          slug,
          app_path: appPath,
          parent_session: parentSession,
          notes
        });
        return reply.code(201).send({ project });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
          return reply.code(409).send({ error: "project slug or app_path already exists" });
        }
        throw error;
      }
    }
  );

  app.get(
    "/api/overmind/projects",
    async (request, reply) => {
      if (!requireProjectReadAuth(request, reply, authService, config.overmind.token)) return;

      return {
        projects: overmindService.listProjects().map(withActiveRunsCount)
      };
    }
  );

  app.get<{ Params: ProjectParams }>(
    "/api/overmind/projects/:slug",
    async (request, reply) => {
      if (!requireProjectReadAuth(request, reply, authService, config.overmind.token)) return;

      const project = overmindService.getProjectBySlug(request.params.slug);
      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      return { project: withActiveRunsCount(project) };
    }
  );

  app.patch<{ Params: ProjectParams; Body: UpdateProjectBody }>(
    "/api/overmind/projects/:slug",
    async (request, reply) => {
      if (!requireOwnerJwtForProjectMutation(request, reply, authService, config.overmind.token)) return;

      if (request.body?.slug !== undefined || request.body?.app_path !== undefined) {
        return reply.code(400).send({ error: "slug and app_path are immutable" });
      }

      const input: { parent_session?: string; notes?: string | null } = {};
      if (request.body?.parent_session !== undefined) {
        if (typeof request.body.parent_session !== "string" || !request.body.parent_session.trim()) {
          return reply.code(400).send({ error: "'parent_session' must be a non-empty string" });
        }
        input.parent_session = request.body.parent_session.trim();
      }
      if (request.body?.notes !== undefined) {
        if (request.body.notes !== null && typeof request.body.notes !== "string") {
          return reply.code(400).send({ error: "'notes' must be a string or null" });
        }
        input.notes = request.body.notes;
      }
      if (input.parent_session === undefined && input.notes === undefined) {
        return reply.code(400).send({ error: "parent_session or notes is required" });
      }

      const project = overmindService.updateProjectBySlug(request.params.slug, input);
      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      return { project: withActiveRunsCount(project) };
    }
  );

  app.delete<{ Params: ProjectParams; Body: TokenBody }>(
    "/api/overmind/projects/:slug",
    async (request, reply) => {
      if (!requireOwnerJwtForProjectMutation(request, reply, authService, config.overmind.token)) return;

      const project = overmindService.getProjectBySlug(request.params.slug);
      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      const activeRuns = overmindService.activeRunsCountForProjectSlug(request.params.slug);
      if (activeRuns > 0) {
        return reply.code(409).send({
          error: "project has active runs; complete or cancel them first",
          active_runs: activeRuns
        });
      }

      overmindService.deleteProjectBySlug(request.params.slug);
      return { ok: true };
    }
  );

  app.post<{ Body: RegisterBody }>(
    "/api/overmind/register",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { label, parent_label, parent_session, project_slug, session, child_sessions, child_roles, run_dir, current_task, tasks } = request.body || {};
      const hasRunDir = typeof run_dir === "string" && run_dir.trim() !== "";
      const isLegacyShape =
        typeof label === "string" && label.trim() !== "" &&
        typeof session === "string" && session.trim() !== "";
      const isAttachShape = hasRunDir && !isLegacyShape;

      if (isAttachShape) {
        const forbiddenFields: Array<keyof RegisterBody> = [
          "label",
          "parent_label",
          "parent_session",
          "project_slug",
          "session"
        ];
        for (const field of forbiddenFields) {
          if (request.body && request.body[field] !== undefined) {
            return reply.code(422).send({ error: "forbidden-derived-field", field });
          }
        }

        if (!path.isAbsolute(run_dir)) {
          return reply.code(400).send({
            error: `'run_dir' must be an absolute path. Got: '${run_dir}'. Use the canonical path on disk; relative paths are ambiguous because overmind and the caller may have different cwds.`
          });
        }

        const match = await overmindService.findProjectForRunDir(run_dir);
        if (!match.project) {
          return reply.code(404).send({
            error: "no-project-for-run-dir",
            run_dir: match.run_dir,
            searched_up_to: match.searched_up_to,
            hint: "Ask JROM to create a project for the containing app via POST /api/overmind/projects, then re-register."
          });
        }

        const workflow = overmindService.registerAttached({
          project_id: match.project.id,
          label: `${match.project.slug} · ${path.basename(match.run_dir) || "run"}`,
          run_dir: match.run_dir
        });
        return reply.code(201).send({
          workflow,
          workflow_id: workflow.id,
          project_id: match.project.id,
          project_slug: match.project.slug,
          parent_session: match.project.parent_session
        });
      }

      // JROM 2026-05-24: "we must validate all ... not some lame ass lazy not
      // checking always accepting what is given to him". Full payload validation
      // before we touch the database.

      // Required string fields — type + non-empty (explicit checks so TS narrows).
      if (typeof label !== "string" || !label.trim()) {
        return reply.code(400).send({ error: "'label' must be a non-empty string" });
      }
      if (typeof session !== "string" || !session.trim()) {
        return reply.code(400).send({ error: "'session' must be a non-empty string" });
      }
      if (typeof run_dir !== "string" || !run_dir.trim()) {
        return reply.code(400).send({ error: "'run_dir' must be a non-empty string" });
      }

      // tmux session name shape — must match a valid identifier (alphanumeric + . _ -).
      // tmux's own grammar rejects whitespace, ':', and a few other chars; we tighten further.
      const SESSION_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
      if (!SESSION_NAME_RE.test(session)) {
        return reply.code(400).send({
          error: `'session' must be a tmux-safe identifier (letters, digits, dots, underscores, dashes; ≤80 chars). Got: '${session}'`
        });
      }
      if (child_sessions !== undefined) {
        if (!Array.isArray(child_sessions)) {
          return reply.code(400).send({ error: "'child_sessions' must be an array of strings" });
        }
        for (const s of child_sessions) {
          if (typeof s !== "string" || !SESSION_NAME_RE.test(s)) {
            return reply.code(400).send({ error: `child_sessions entry '${s}' is not a tmux-safe identifier` });
          }
        }
      }
      if (child_roles !== undefined) {
        if (!Array.isArray(child_roles)) {
          return reply.code(400).send({ error: "'child_roles' must be an array of strings" });
        }
        for (const r of child_roles) {
          if (typeof r !== "string" || !r.trim()) {
            return reply.code(400).send({ error: "every child_roles entry must be a non-empty string" });
          }
        }
        if (Array.isArray(child_sessions) && child_roles.length !== child_sessions.length) {
          return reply.code(400).send({
            error: `child_roles length (${child_roles.length}) must match child_sessions length (${child_sessions.length}) — overmind labels them by index`
          });
        }
      }

      // run_dir must be an absolute path. (Existence is checked by the watcher's
      // completeness layer; we don't require it on disk at register time because
      // projcore may register before the run_dir is created — but it MUST be absolute,
      // otherwise the watcher can't resolve it consistently across cwds.)
      if (!path.isAbsolute(run_dir)) {
        return reply.code(400).send({
          error: `'run_dir' must be an absolute path. Got: '${run_dir}'. Use the canonical path on disk; relative paths are ambiguous because overmind and the caller may have different cwds.`
        });
      }

      // tasks shape: array of { id: string, label: string, state: "done"|"processing"|"pending" }
      if (tasks !== undefined) {
        if (!Array.isArray(tasks)) {
          return reply.code(400).send({ error: "'tasks' must be an array" });
        }
        const VALID_TASK_STATES = new Set(["done", "processing", "pending"]);
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i] as { id?: unknown; label?: unknown; state?: unknown };
          if (typeof t?.id !== "string" || !t.id.trim()) {
            return reply.code(400).send({ error: `tasks[${i}].id must be a non-empty string` });
          }
          if (typeof t.label !== "string" || !t.label.trim()) {
            return reply.code(400).send({ error: `tasks[${i}].label must be a non-empty string` });
          }
          if (typeof t.state !== "string" || !VALID_TASK_STATES.has(t.state)) {
            return reply.code(400).send({
              error: `tasks[${i}].state must be one of done|processing|pending. Got: '${t.state}'`
            });
          }
        }
      }

      // current_task is optional, but if present must be a string.
      if (current_task !== undefined && current_task !== null && typeof current_task !== "string") {
        return reply.code(400).send({ error: "'current_task' must be a string or null" });
      }

      // JROM 2026-05-24: "why the fuck do we allow a fake parent session" — validate
      // the coordinator_session is a live tmux session BEFORE accepting the register.
      // A fake session is unreachable for nudges and silently rots as "stuck". Only
      // enforced when tmuxService is wired (always in prod; tests pass a mock).
      if (tmuxService && typeof tmuxService.sessionExists === "function") {
        let isAlive = false;
        try {
          isAlive = await tmuxService.sessionExists(session as string);
        } catch {
          isAlive = false;
        }
        if (!isAlive) {
          return reply.code(400).send({
            error:
              `Overmind: coordinator_session '${session}' is not an alive tmux session. ` +
              `Overmind tracks ACTIVE tmux sessions only — a non-existent parent is unreachable ` +
              `for nudges and would silently sit as 'stuck' on the dashboard forever. ` +
              `Run \`tmux new-session -d -s ${session}\` first (or use the session you actually want ` +
              `overmind to track), then re-POST /api/overmind/register.`
          });
        }
      }

      // Step 1: existing coordinator_session keeps the current upsert behavior.
      const existingBySession = overmindService.getBySession(session);

      // JROM 2026-05-24: "when a new parent session submits a start status demand a
      // proper tasklist". Applies to INSERTs only (no row for this coordinator_session
      // yet). Re-registers/upserts may omit tasks to update only other fields — the
      // destructive-overwrite safeguard below preserves the existing list in that case.
      const isNewParentSession = !existingBySession;
      if (isNewParentSession && (!Array.isArray(tasks) || tasks.length === 0)) {
        return reply.code(400).send({
          error:
            "Overmind: please include a non-empty `tasks` array in your /register payload. " +
            "Build it from queue.md / your batch plan / req-matrix.md — overmind needs the " +
            "tasklist to track this run, and an empty register leaves the dashboard at 0/0 " +
            "which is unactionable."
        });
      }
      // Cross-project upsert guard (JROM 2026-05-24): if the parent re-registers
      // their existing coordinator_session BUT the new run_dir sits in a different
      // project tree than the existing row's run_dir, that's the receiptbot-on-AGJ-51
      // destructive-overwrite bug. The session row should track ONE project tree
      // forever — pick a different coordinator_session for genuinely different work.
      if (existingBySession) {
        const sharesTree = await overmindService.sharesProjectTree(
          existingBySession.run_dir,
          run_dir
        );
        if (!sharesTree) {
          const correctiveAdvice =
            `Overmind: coordinator_session '${session}' is currently tracking the project tree ` +
            `'${existingBySession.run_dir}' (workflow id=${existingBySession.id}, label='${existingBySession.label}'). ` +
            `You tried to re-register it pointing at '${run_dir}', which is a DIFFERENT project tree. ` +
            `Don't reuse a parent session for unrelated projects — pick a fresh coordinator_session for this work ` +
            `(e.g. '${session}-${path.basename(run_dir)}' or a project-specific name). One workflow per project tree.`;
          if (tmuxService) {
            try {
              const parentAlive = typeof tmuxService.sessionExists === "function"
                ? await tmuxService.sessionExists(session)
                : true;
              if (parentAlive) {
                const nowMs = Date.now();
                const lastSentAt =
                  nudgeState?.getRegisterAdviceCooldown(session, existingBySession.id) ?? 0;
                if (nowMs - lastSentAt >= REGISTER_CONFLICT_NUDGE_COOLDOWN_MS) {
                  const delivered = await tmuxService.sendAndSubmit(session, correctiveAdvice);
                  if (delivered) {
                    nudgeState?.setRegisterAdviceCooldown(session, existingBySession.id, nowMs);
                  }
                }
              }
            } catch (error) {
              console.error("Overmind cross-project upsert advice send failed:", error);
            }
          }
          return reply.code(409).send({
            error: correctiveAdvice,
            existing_session_tracks: {
              id: existingBySession.id,
              coordinator_session: existingBySession.coordinator_session,
              label: existingBySession.label,
              run_dir: existingBySession.run_dir
            }
          });
        }
      }

      if (!existingBySession) {
        // Step 2: enforce one workflow per project tree via run_dir prefix matching.
        const projectTreeMatch = await overmindService.findProjectTreeMatch(run_dir);
        if (projectTreeMatch && projectTreeMatch.coordinator_session !== session) {
          const correctiveAdvice = buildProjectTreeConflictMessage(projectTreeMatch);

          if (tmuxService) {
            try {
              const parentAlive = typeof tmuxService.sessionExists === "function"
                ? await tmuxService.sessionExists(session)
                : true;
              if (parentAlive) {
                const nowMs = Date.now();
                const lastSentAt = nudgeState?.getRegisterAdviceCooldown(session, projectTreeMatch.id) ?? 0;
                if (nowMs - lastSentAt >= REGISTER_CONFLICT_NUDGE_COOLDOWN_MS) {
                  const delivered = await tmuxService.sendAndSubmit(session, correctiveAdvice);
                  if (delivered) {
                    nudgeState?.setRegisterAdviceCooldown(session, projectTreeMatch.id, nowMs);
                  }
                }
              }
            } catch (error) {
              console.error("Overmind register corrective advice send failed:", error);
            }
          }

          return reply.code(409).send({
            error: correctiveAdvice,
            use_existing: {
              id: projectTreeMatch.id,
              coordinator_session: projectTreeMatch.coordinator_session,
              label: projectTreeMatch.label,
              run_dir: projectTreeMatch.run_dir
            }
          });
        }
      }

      // Step 3: brand-new tree OR same-session upsert.
      //
      // Destructive-overwrite safeguard (JROM 2026-05-24): a re-register against an
      // existing session that omits `tasks` (or sends []) used to silently wipe the
      // existing tasklist — which is exactly how the HRIS / AGJ-51 rows lost their
      // tasks on 2026-05-24. Preserve the existing tasks + current_task in that case.
      const effectiveTasks =
        Array.isArray(tasks) && tasks.length > 0
          ? tasks
          : existingBySession?.tasks ?? [];
      const effectiveCurrentTask =
        current_task !== undefined ? current_task : existingBySession?.current_task ?? null;

      const workflow = overmindService.register({
        label,
        coordinator_session: session,
        child_sessions,
        child_roles,
        run_dir,
        current_task: effectiveCurrentTask,
        tasks: effectiveTasks
      });
      return reply.code(201).send({ workflow, reminder: `Setup checklist (required after every register): (1) Watcher — run: PROJCORE_POLL_SECONDS=15 PROJCORE_BUSY_MARKERS='esc to interrupt|Working (|Waiting for' bash ~/.claude/agents/watchers/projcore-watcher.sh ${workflow.coordinator_session} <status_file> <issue_id> — catches idle/completion in ~20s; (2) Wakeup fallback — call ScheduleWakeup with a long interval (1200s+) so the loop restarts if the watcher exits early. Both are required — watcher alone misses overnight stalls; wakeup alone is too slow for normal completions.` });
    }
  );

  app.post<{ Body: CompleteBody }>(
    "/api/overmind/complete",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { workflow_id, run_dir, session } = request.body || {};
      if (!hasWorkflowLookupKey({ workflow_id, run_dir, session })) {
        return reply.code(400).send({ error: "workflow_id, run_dir, or session is required" });
      }

      const workflow = overmindService.findWorkflow({ workflow_id, run_dir, session });
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      const completed = overmindService.setStatus(workflow.id, "completed", { touchParentUpdate: true });
      if (
        workflow.status !== "completed" &&
        completed &&
        overmindService.markNotificationTransition(completed.id, "done:completed")
      ) {
        try {
          await notify?.(buildDoneNotification(completed));
        } catch (error) {
          console.error("Overmind DONE notify failed:", error);
        }

        try {
          if (tmuxService) {
            const aliveChildren: string[] = [];
            if (completed.child_sessions && completed.child_sessions.length > 0) {
              const aliveChecks = await Promise.all(
                completed.child_sessions.map(async (child) => {
                  const alive = await tmuxService.sessionExists(child);
                  return alive ? child : null;
                })
              );
              aliveChildren.push(...aliveChecks.filter((c): c is string => c !== null));
            }

            const notDoneTaskIds = (completed.tasks ?? [])
              .filter((t) => t.state !== "done")
              .map((t) => t.id);

            const parts: string[] = [];
            if (aliveChildren.length > 0) {
              const killCmds = aliveChildren.map((c) => `tmux kill-session -t ${c}`).join(" ; ");
              parts.push(`Overmind: '${completed.label}' is marked complete — please close your child session(s) to free resources (your own session can stay up): ${killCmds}`);
            }
            if (notDoneTaskIds.length > 0) {
              parts.push(`Also your task list still shows these as not-done — please POST /api/overmind/tasks marking them done if the run truly finished: ${notDoneTaskIds.join(", ")}.`);
            }

            if (parts.length > 0) {
              const msg = parts.join(" ");
              if (completed.coordinator_session) {
                await tmuxService.sendAndSubmit(completed.coordinator_session, msg);
              }
            }
          }
        } catch (error) {
          console.error("Overmind child-close reminder failed:", error);
        }
      }

      return { workflow: completed };
    }
  );

  app.post<{ Body: TasksBody }>(
    "/api/overmind/tasks",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { workflow_id, run_dir, session, current_task, tasks } = request.body || {};
      if (!hasWorkflowLookupKey({ workflow_id, run_dir, session }) || !Array.isArray(tasks)) {
        return reply.code(400).send({ error: "workflow_id, run_dir, or session and tasks are required" });
      }

      const workflow = overmindService.findWorkflow({ workflow_id, run_dir, session });
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      return { workflow: overmindService.setTasks(workflow.id, current_task ?? null, tasks) };
    }
  );

  app.post<{ Body: ChildrenBody }>(
    "/api/overmind/children",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { workflow_id, run_dir, session, child_sessions, child_roles } = request.body || {};
      if (!hasWorkflowLookupKey({ workflow_id, run_dir, session })) {
        return reply.code(400).send({ error: "workflow_id, run_dir, or session is required" });
      }
      if (!Array.isArray(child_sessions)) {
        return reply.code(400).send({ error: "child_sessions is required" });
      }
      if (child_roles !== undefined && !Array.isArray(child_roles)) {
        return reply.code(400).send({ error: "child_roles must be an array" });
      }
      const roles = child_roles ?? [];
      if (roles.length > 0 && roles.length !== child_sessions.length) {
        return reply.code(400).send({
          error: `child_roles length (${roles.length}) must match child_sessions length (${child_sessions.length})`
        });
      }

      const workflow = overmindService.findWorkflow({ workflow_id, run_dir, session });
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      return { workflow: overmindService.setChildren(workflow.id, child_sessions, roles) };
    }
  );

  app.get<{ Querystring: { status?: OvermindWorkflowStatus } }>(
    "/api/overmind/workflows",
    { preHandler: authMiddleware },
    async (request) => {
      return { workflows: overmindService.list(request.query.status) };
    }
  );

  app.get<{ Querystring: { session?: string } }>(
    "/api/overmind/history",
    { preHandler: authMiddleware },
    async (request) => {
      const { session } = request.query;
      return { history: overmindService.listHistory(session || undefined) };
    }
  );

  app.get(
    "/api/overmind/runs",
    { preHandler: authMiddleware },
    async (): Promise<{ runs: RunSummary[] }> => {
      return { runs: overmindService.listRuns() };
    }
  );

  app.post<{ Params: WorkflowParams; Body: TokenBody }>(
    "/api/overmind/workflows/:id/pause",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const id = parseWorkflowId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }

      // projcore RELAY of a JROM-initiated pause. projcore must never call this on its own
      // initiative (see projcore.md §2.11) — only when JROM explicitly tells it to.
      const workflow = overmindService.setMonitoringPaused(id, true, "projcore-relay");
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      streamManager?.broadcast();
      return { workflow };
    }
  );

  app.post<{ Params: WorkflowParams; Body: TokenBody }>(
    "/api/overmind/workflows/:id/resume",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const id = parseWorkflowId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }

      const workflow = overmindService.setMonitoringPaused(id, false, null);
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      streamManager?.broadcast();
      return { workflow };
    }
  );

  // JWT (owner) pause/resume for the dashboard button — always JROM-initiated.
  app.post<{ Params: RenameParams }>(
    "/api/overmind/workflows/:id/pause-monitoring",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }
      const workflow = overmindService.setMonitoringPaused(id, true, "jrom");
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }
      streamManager?.broadcast();
      return { workflow };
    }
  );

  app.post<{ Params: RenameParams }>(
    "/api/overmind/workflows/:id/resume-monitoring",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }
      const workflow = overmindService.setMonitoringPaused(id, false, null);
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }
      streamManager?.broadcast();
      return { workflow };
    }
  );

  // Dual-authed: accepts either the loopback+token combo (for projcore-style
  // programmatic cleanup) OR a JWT-owner session (for dashboard "Delete" button).
  // JROM 2026-05-24: "allow deletion of actual workflows on history or the tasks
  // list themselves, so i can clean them up myself".
  app.delete<{ Params: WorkflowParams; Body: TokenBody }>(
    "/api/overmind/workflows/:id",
    async (request, reply) => {
      // Try JWT-owner first (browser path). If the auth header is absent or invalid,
      // fall back to the loopback+token path (projcore CLI path).
      const sessionUser = await tryAuthOwner(request, authService);
      if (!sessionUser) {
        if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;
      }

      const id = parseWorkflowId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }

      if (!overmindService.delete(id)) {
        return reply.code(404).send({ error: "Workflow not found" });
      }
      nudgeState?.forgetWorkflow(id);

      streamManager?.broadcast();
      return { ok: true };
    }
  );

  // Owner-only: delete a single task-history entry from the workflow drill-down.
  // JROM 2026-05-24 cleanup feature.
  app.delete<{ Params: { id: string } }>(
    "/api/overmind/history/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }
      const entryId = Number(request.params.id);
      if (!Number.isInteger(entryId) || entryId < 1) {
        return reply.code(400).send({ error: "Invalid history entry id" });
      }
      if (!overmindService.deleteHistoryEntry(entryId)) {
        return reply.code(404).send({ error: "History entry not found" });
      }
      return { ok: true };
    }
  );

  app.post<{ Params: RenameParams; Body: RenameBody }>(
    "/api/overmind/workflows/:id/name",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }

      const { name } = request.body || {};
      if (name !== undefined && name !== null && typeof name !== "string") {
        return reply.code(400).send({ error: "name must be a string or null" });
      }

      const workflow = overmindService.setDisplayName(id, name ?? null);
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      return { workflow };
    }
  );

  app.post<{ Params: WorkflowParams; Body: AskUpdateCooldownBody }>(
    "/api/overmind/workflows/:id/ask-update-cooldown",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const id = parseWorkflowId(request.params.id);
      if (id === null) {
        return reply.code(400).send({ error: "Invalid workflow id" });
      }

      const overrideMinutes = request.body?.override_minutes;
      if (overrideMinutes !== undefined && overrideMinutes !== null) {
        if (
          !Number.isInteger(overrideMinutes) ||
          overrideMinutes < 5 ||
          overrideMinutes > 240 ||
          overrideMinutes % 5 !== 0
        ) {
          return reply.code(400).send({
            error: "override_minutes must be null or an integer multiple of 5 between 5 and 240"
          });
        }
      }

      let workflow = null;
      try {
        workflow = overmindService.setEvidenceIdleThresholdOverride(id, overrideMinutes ?? null);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }
      streamManager?.broadcast();
      return { workflow };
    }
  );

  app.post(
    "/api/overmind/ovm/open",
    { preHandler: authMiddleware },
    async (_request, reply) => {
      if (!ovmSession) {
        return reply.code(503).send({ error: "OVM session manager is not configured" });
      }

      return ovmSession.open();
    }
  );

  app.post(
    "/api/overmind/ovm/restart",
    { preHandler: authMiddleware },
    async (_request, reply) => {
      if (!ovmSession) {
        return reply.code(503).send({ error: "OVM session manager is not configured" });
      }

      return ovmSession.restart();
    }
  );

  app.post(
    "/api/overmind/ovm/close",
    { preHandler: authMiddleware },
    async (_request, reply) => {
      if (!ovmSession) {
        return reply.code(503).send({ error: "OVM session manager is not configured" });
      }

      return ovmSession.close();
    }
  );

  app.get(
    "/api/overmind/ovm/status",
    { preHandler: authMiddleware },
    async (_request, reply) => {
      if (!ovmSession) {
        return reply.code(503).send({ error: "OVM session manager is not configured" });
      }

      return ovmSession.status();
    }
  );

  app.post<{ Body: SendBody }>(
    "/api/overmind/ovm/send",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (!ovmSession) {
        return reply.code(503).send({ error: "OVM session manager is not configured" });
      }

      const { message } = request.body || {};
      if (!message || typeof message !== "string" || !message.trim()) {
        return reply.code(400).send({ error: "message is required" });
      }

      return ovmSession.sendAndAwaitReply(message.trim());
    }
  );

  app.get(
    "/api/overmind/ovm/reply",
    { preHandler: authMiddleware },
    async (_request, reply) => {
      if (!ovmSession) {
        return reply.code(503).send({ error: "OVM session manager is not configured" });
      }

      const result = await ovmSession.getReply();
      if (result === null) {
        return reply.code(404).send({ error: "No in-flight OVM send" });
      }

      return result;
    }
  );

  if (streamManager) {
    app.get<{ Querystring: { token?: string } }>(
      "/ws/overmind",
      { websocket: true },
      async (socket, request) => {
        const token = (request.query as Record<string, string>).token || "";
        await streamManager.handleConnection(socket, token);
      }
    );
  }
}
