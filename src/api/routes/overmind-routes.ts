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
  OvermindWorkflowStatus,
  OvermindActiveRun,
  RunSummary
} from "../../services/overmind-service.js";
import type { OvermindNotify } from "../../services/overmind-watcher.js";
import { buildDoneNotification } from "../../services/overmind-notifications.js";
import { OvermindStreamManager } from "../websocket/overmind-stream-manager.js";
import type { OvmSessionManager } from "../../services/ovm-session.js";
import type { TmuxService } from "../../tmux/tmux-service.js";
import type { NudgeStateService } from "../../services/nudge-state-service.js";
import { isAgentPane, type AgentPaneKind } from "../../services/overmind/agent-pane.js";
import { resolveParentSession } from "../../services/overmind/parent-session-resolver.js";
import { augmentWorkflowSparkHealth } from "../../services/overmind/spark-health.js";
import type { OvermindParentStatus } from "../../services/overmind/types.js";
import {
  MAX_TASK_LABEL_LENGTH,
  validateSubmittedTaskList,
  type TaskListValidation
} from "../../services/overmind/sanitize.js";

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

interface ReportParentSessionBody extends TokenBody {
  parent_session?: string;
  app_path?: string | null;
  reported_by?: string;
  run_id?: string | number | null;
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

interface ActiveRunChild {
  session: string;
  role: string;
}

interface ActiveRunResponseItem {
  run_id: number;
  run_dir: string;
  label: string;
  parent_label: string;
  parent_session: string;
  status: OvermindWorkflowStatus;
  registered_at: string;
  children: ActiveRunChild[];
  dispatch_manifests: string[];
}

interface ActiveRunsResponse {
  runs: ActiveRunResponseItem[];
}

interface DiscoveryEndpoint {
  name: string;
  method: string;
  path: string;
  auth: string;
  required: string[];
  forbidden: string[];
  input_schema: Record<string, unknown>;
  notes: string;
  example: Record<string, unknown>;
}

const SESSION_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;
// Fail-closed guard: a reported parent session must be a live projcore
// coordinator name in the x-<NN>_projcore_<model>_<project> convention (north
// spawns these dynamically per run). Anything else is rejected, never stored.
const PARENT_SESSION_CONVENTION_RE = /^x-[0-9]{2}_projcore_/;
const PROJECT_MUTATION_FORBIDDEN = {
  error: "projects are JROM-managed; ask JROM to create via dashboard"
};

function validProjectsForRegister(overmindService: OvermindService): Array<{ slug: string; app_path: string }> {
  return overmindService.listProjects().map((project) => ({
    slug: project.slug,
    app_path: project.app_path
  }));
}

function normalizeRegisterParentStatus(kind: AgentPaneKind): OvermindParentStatus {
  if (kind === "claude" || kind === "codex") return "ok";
  if (kind === "bare-bash" || kind === "no-session") return kind;
  return "unknown";
}

function sendInvalidSessionName(
  reply: FastifyReply,
  field: string,
  value: unknown
): void {
  reply.code(422).send({
    ok: false,
    error: "invalid-session-name",
    code: "invalid-session-name",
    message: `${field} must be a tmux-safe identifier.`,
    hint: "Use only letters, digits, dots, underscores, and dashes; maximum length is 80 characters.",
    field,
    value
  });
}

function sendAgentClientError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  hint: string,
  extra: Record<string, unknown> = {},
  error: string = code
): void {
  reply.code(statusCode).send({
    ok: false,
    error,
    code,
    message,
    hint,
    ...extra
  });
}

function sendInvalidTaskList(
  reply: FastifyReply,
  validation: TaskListValidation
): void {
  reply.code(422).send({
    ok: false,
    error: "invalid-task-list",
    code: "invalid-task-list",
    message: "Task list rejected because at least one submitted row is not a real Overmind task.",
    hint: `Rebuild tasks from queue.md with real IDs and labels; skip unparseable rows instead of sending row-N fallback IDs; label ≤${MAX_TASK_LABEL_LENGTH} chars; a task title is not a paragraph.`,
    invalid_tasks: validation.invalid_tasks
  });
}

function sendLegacyRegisterRemoved(reply: FastifyReply): void {
  reply.code(422).send({
    ok: false,
    error: "legacy-register-removed",
    code: "legacy-register-removed",
    message: "Legacy Overmind register payloads are no longer accepted.",
    hint: "registration is attach-only now — POST {run_dir, token}; identity is derived from the project. See GET /api/overmind/register/describe"
  });
}

function parentWarningFor(status: OvermindParentStatus, parentSession: string): { code: string; message: string } | null {
  if (status === "bare-bash") {
    return {
      code: "parent-session-bare-bash",
      message: `Project parent_session '${parentSession}' is a bare shell, not an agent pane. Registration succeeded; start Claude/Codex in that tmux session so Overmind nudges do not paste into bash.`
    };
  }
  if (status === "no-session") {
    return {
      code: "parent-session-no-session",
      message: `Project parent_session '${parentSession}' does not exist. Registration succeeded; create/start that tmux session so Overmind can reach the parent agent.`
    };
  }
  return null;
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
    sendAgentClientError(
      reply,
      403,
      "localhost-only",
      "Overmind lifecycle endpoints are localhost-only.",
      "Call this endpoint from 127.0.0.1/localhost; remote lifecycle writes are rejected.",
      {},
      "Overmind lifecycle endpoints are localhost-only"
    );
    return false;
  }

  const headerToken = request.headers["x-overmind-token"];
  const body = request.body as TokenBody | undefined;
  const token = body?.token || (Array.isArray(headerToken) ? headerToken[0] : headerToken);
  if (!token || token !== expectedToken) {
    sendAgentClientError(
      reply,
      401,
      "invalid-overmind-token",
      "Missing or invalid overmind token.",
      "Send the configured Overmind token in body.token or the x-overmind-token header.",
      {},
      "Missing or invalid overmind token"
    );
    return false;
  }

  return true;
}

function requireLoopbackAndTokenCredential(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string
): boolean {
  if (!isLoopbackAddress(request.ip)) {
    reply.code(403).send({ error: "Overmind lifecycle endpoints are localhost-only" });
    return false;
  }

  const headerToken = request.headers["x-overmind-token"];
  const body = request.body as TokenBody | undefined;
  const token = body?.token || (Array.isArray(headerToken) ? headerToken[0] : headerToken);
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

function listDispatchManifests(runDir: string): string[] {
  const dispatchDir = path.join(runDir, "dispatch");
  try {
    return fs.readdirSync(dispatchDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(dispatchDir, entry.name))
      .sort();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return [];
    }
    throw error;
  }
}

function mapActiveRunForDaemon(activeRun: OvermindActiveRun): ActiveRunResponseItem {
  const { workflow, project_slug, parent_session } = activeRun;
  return {
    run_id: workflow.id,
    run_dir: workflow.run_dir,
    label: workflow.label || project_slug,
    parent_label: project_slug,
    parent_session,
    status: workflow.status,
    registered_at: workflow.created_at,
    children: workflow.child_sessions.map((session, index) => ({
      session,
      role: workflow.child_roles[index] || "child"
    })),
    dispatch_manifests: listDispatchManifests(workflow.run_dir)
  };
}

function registerDiscoveryEndpoint(): DiscoveryEndpoint {
  return {
    name: "register",
    method: "POST",
    path: "/api/overmind/register",
    auth: "loopback + overmind token in body.token or x-overmind-token",
    required: ["run_dir", "token"],
    forbidden: ["label", "session", "parent_session", "project_slug"],
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["run_dir", "token"],
      properties: {
        run_dir: {
          type: "string",
          minLength: 1,
          description: "Absolute path under a registered overmind project."
        },
        token: {
          type: "string",
          minLength: 1,
          description: "Overmind lifecycle token. May also be supplied as x-overmind-token."
        }
      }
    },
    notes: "Attach registration accepts only run_dir and token; identity is derived server-side from the registered project whose app_path contains run_dir.",
    example: {
      run_dir: "<abs path under a registered project>",
      token: "<overmind token>"
    }
  };
}

function taskSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "label", "state"],
    properties: {
      id: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1, maxLength: MAX_TASK_LABEL_LENGTH },
      state: { type: "string", enum: ["done", "processing", "pending"] },
      estimate_min: { type: ["integer", "null"], minimum: 1 }
    }
  };
}

function workflowLookupAnyOf(): Record<string, unknown>[] {
  return [
    { required: ["workflow_id"] },
    { required: ["run_dir"] },
    { required: ["session"] }
  ];
}

function discoveryEndpoints(): DiscoveryEndpoint[] {
  const workflowLookupProperties = {
    workflow_id: { type: ["integer", "string"], minLength: 1 },
    run_dir: { type: "string", minLength: 1 },
    session: { type: "string", minLength: 1 },
    token: { type: "string", minLength: 1 }
  };

  return [
    registerDiscoveryEndpoint(),
    {
      name: "tasks",
      method: "POST",
      path: "/api/overmind/tasks",
      auth: "loopback + overmind token in body.token or x-overmind-token",
      required: ["workflow_id|run_dir|session", "tasks", "token"],
      forbidden: [],
      input_schema: {
        type: "object",
        additionalProperties: false,
        anyOf: workflowLookupAnyOf(),
        required: ["tasks", "token"],
        properties: {
          ...workflowLookupProperties,
          current_task: { type: ["string", "null"] },
          tasks: { type: "array", items: taskSchema() }
        }
      },
      notes: "Replaces the workflow task list. Use state for done-ness; keep labels short.",
      example: {
        run_dir: "<registered run_dir>",
        current_task: "B12 implementation",
        tasks: [{ id: "B12", label: "OVM discovery and envelopes", state: "processing", estimate_min: 25 }],
        token: "<overmind token>"
      }
    },
    {
      name: "children",
      method: "POST",
      path: "/api/overmind/children",
      auth: "loopback + overmind token in body.token or x-overmind-token",
      required: ["workflow_id|run_dir|session", "child_sessions", "token"],
      forbidden: [],
      input_schema: {
        type: "object",
        additionalProperties: false,
        anyOf: workflowLookupAnyOf(),
        required: ["child_sessions", "token"],
        properties: {
          ...workflowLookupProperties,
          child_sessions: {
            type: "array",
            items: { type: "string", pattern: SESSION_NAME_RE.source }
          },
          child_roles: {
            type: "array",
            items: { type: "string" },
            description: "Optional; when provided, length must match child_sessions."
          }
        }
      },
      notes: "Sets the complete child session roster for the workflow.",
      example: {
        workflow_id: 123,
        child_sessions: ["AGJ-b12-codex"],
        child_roles: ["implementer"],
        token: "<overmind token>"
      }
    },
    {
      name: "parent-session",
      method: "POST",
      path: "/api/overmind/parent-session",
      auth: "loopback + overmind token in body.token or x-overmind-token",
      required: ["parent_session", "token"],
      forbidden: [],
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["parent_session", "token"],
        properties: {
          parent_session: {
            type: "string",
            pattern: PARENT_SESSION_CONVENTION_RE.source,
            description: "Live projcore coordinator session, x-<NN>_projcore_<model>_<project>."
          },
          app_path: {
            type: "string",
            minLength: 1,
            description: "Project app_path (recommended primary key). Omit to resolve by the session's trailing project slug."
          },
          reported_by: { type: "string", description: "Caller identity, e.g. '[north] <session>'." },
          run_id: { type: ["string", "integer", "null"], description: "Optional run correlation id." },
          token: { type: "string", minLength: 1 }
        }
      },
      notes: "Reports the dynamic coordinator name at projcore-spawn (and on respawn/seat-swap) so the panel PARENT_SESSION + UPDATED_AT stay live. Idempotent upsert; resolves by app_path then trailing project slug; unresolvable → 404, never creates a project.",
      example: {
        parent_session: "x-06_projcore_grok45_helm",
        app_path: "/home/agjrom/TGBOTS/Helm",
        reported_by: "[north] north-main",
        token: "<overmind token>"
      }
    },
    {
      name: "complete",
      method: "POST",
      path: "/api/overmind/complete",
      auth: "loopback + overmind token in body.token or x-overmind-token",
      required: ["workflow_id|run_dir|session", "token"],
      forbidden: [],
      input_schema: {
        type: "object",
        additionalProperties: false,
        anyOf: workflowLookupAnyOf(),
        required: ["token"],
        properties: workflowLookupProperties
      },
      notes: "Marks a workflow completed and emits the completion transition notification once.",
      example: {
        run_dir: "<registered run_dir>",
        token: "<overmind token>"
      }
    },
    {
      name: "pause",
      method: "POST",
      path: "/api/overmind/workflows/:id/pause",
      auth: "loopback + overmind token in body.token or x-overmind-token",
      required: ["id path parameter", "token"],
      forbidden: [],
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["token"],
        properties: {
          token: { type: "string", minLength: 1 }
        }
      },
      notes: "Pauses monitoring for a workflow as a relay of an explicit JROM/projcore control action.",
      example: {
        token: "<overmind token>"
      }
    },
    {
      name: "resume",
      method: "POST",
      path: "/api/overmind/workflows/:id/resume",
      auth: "loopback + overmind token in body.token or x-overmind-token",
      required: ["id path parameter", "token"],
      forbidden: [],
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["token"],
        properties: {
          token: { type: "string", minLength: 1 }
        }
      },
      notes: "Resumes monitoring for a paused workflow.",
      example: {
        token: "<overmind token>"
      }
    }
  ];
}

function liveDiscoveryProjects(overmindService: OvermindService): Array<{ slug: string; app_path: string; parent_session: string }> {
  return overmindService.listProjects().map((project) => ({
    slug: project.slug,
    app_path: project.app_path,
    parent_session: project.parent_session
  }));
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

  const withProjectReadMetadata = (project: OvermindProject) => ({
    ...project,
    active_runs_count: overmindService.activeRunsCountForProjectSlug(project.slug),
    latest_parent_status: overmindService.latestParentStatusForProjectSlug(project.slug)
  });

  app.get(
    "/api/overmind/runs/active",
    async (request, reply): Promise<ActiveRunsResponse | void> => {
      if (!requireLoopbackAndTokenCredential(request, reply, config.overmind.token)) return;

      return {
        runs: overmindService.listActiveRunsForDaemon().map(mapActiveRunForDaemon)
      };
    }
  );

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
      if (!SESSION_NAME_RE.test(parentSession)) {
        return sendInvalidSessionName(reply, "parent_session", parentSession);
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
        projects: overmindService.listProjects().map(withProjectReadMetadata)
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

      return { project: withProjectReadMetadata(project) };
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
        if (!SESSION_NAME_RE.test(input.parent_session)) {
          return sendInvalidSessionName(reply, "parent_session", input.parent_session);
        }
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

      return { project: withProjectReadMetadata(project) };
    }
  );

  // north reports the DYNAMIC projcore coordinator name at spawn time (and again
  // on respawn/seat-swap) so the panel's PARENT_SESSION + UPDATED_AT track the
  // live coordinator instead of a stale hardcoded value. Idempotent upsert onto
  // the resolved project; never creates a project (unresolvable → 404).
  app.post<{ Body: ReportParentSessionBody }>(
    "/api/overmind/parent-session",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const parentSession = typeof request.body?.parent_session === "string"
        ? request.body.parent_session.trim()
        : "";
      const appPath = typeof request.body?.app_path === "string"
        ? request.body.app_path.trim()
        : "";
      const reportedBy = typeof request.body?.reported_by === "string"
        ? request.body.reported_by.trim()
        : "";

      if (!parentSession) {
        return sendAgentClientError(
          reply,
          400,
          "missing-parent-session",
          "'parent_session' is required.",
          "Send parent_session as the live coordinator name in the x-<NN>_projcore_<model>_<project> convention.",
          {},
          "'parent_session' is required"
        );
      }
      if (!PARENT_SESSION_CONVENTION_RE.test(parentSession)) {
        return sendAgentClientError(
          reply,
          400,
          "invalid-parent-session-format",
          `parent_session '${parentSession}' does not match the projcore coordinator convention.`,
          "Value must start with x-<NN>_projcore_ (e.g. x-06_projcore_grok45_helm).",
          { pattern: PARENT_SESSION_CONVENTION_RE.source },
          `parent_session '${parentSession}' does not match the projcore coordinator convention`
        );
      }
      if (!SESSION_NAME_RE.test(parentSession)) {
        return sendInvalidSessionName(reply, "parent_session", parentSession);
      }
      if (appPath && !path.isAbsolute(appPath)) {
        return sendAgentClientError(
          reply,
          400,
          "invalid-app-path",
          `'app_path' must be an absolute path. Got: '${appPath}'.`,
          "Send the project's canonical absolute app_path, or omit it to resolve by the session's trailing project slug.",
          {},
          `'app_path' must be an absolute path. Got: '${appPath}'`
        );
      }

      const result = await overmindService.reportParentSession({
        parent_session: parentSession,
        app_path: appPath || null
      });

      if (!result.project) {
        const validProjects = liveDiscoveryProjects(overmindService);
        return reply.code(404).send({
          ok: false,
          error: "no-project-for-parent-session",
          code: "no-project-for-parent-session",
          message: appPath
            ? `No registered overmind project matches app_path '${appPath}' or the trailing project slug of '${parentSession}'.`
            : `No registered overmind project matches the trailing project slug of '${parentSession}'.`,
          hint: "Provide the project's app_path, or ensure the session's trailing _<project> slug matches a registered project slug. This endpoint never creates projects.",
          validProjects
        });
      }

      console.info(
        `[overmind] parent-session reported: project='${result.project.slug}' parent_session='${parentSession}' matched_by=${result.matched_by} reported_by='${reportedBy || "unknown"}'`
      );

      streamManager?.broadcast();

      return reply.code(200).send({
        ok: true,
        matched_by: result.matched_by,
        project: withProjectReadMetadata(result.project)
      });
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

  app.get(
    "/api/overmind/describe",
    async (request, reply) => {
      if (!requireLoopbackAndTokenCredential(request, reply, config.overmind.token)) return;

      return {
        ok: true,
        version: 2,
        endpoints: discoveryEndpoints(),
        projects: liveDiscoveryProjects(overmindService)
      };
    }
  );

  app.get(
    "/api/overmind/register/describe",
    async (request, reply) => {
      if (!requireLoopbackAndTokenCredential(request, reply, config.overmind.token)) return;

      return {
        ok: true,
        version: 1,
        register: registerDiscoveryEndpoint(),
        endpoints: discoveryEndpoints(),
        projects: liveDiscoveryProjects(overmindService)
      };
    }
  );

  app.post<{ Body: RegisterBody }>(
    "/api/overmind/register",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { label, session, run_dir, current_task, tasks } = request.body || {};
      const hasRunDir = typeof run_dir === "string" && run_dir.trim() !== "";
      const isFullLegacyShape =
        typeof label === "string" && label.trim() !== "" &&
        typeof session === "string" && session.trim() !== "";
      if (!hasRunDir || isFullLegacyShape) {
        return sendLegacyRegisterRemoved(reply);
      }

      let submittedTasks: OvermindTask[] | undefined;
      if (tasks !== undefined) {
        const validation = validateSubmittedTaskList(tasks);
        if (!validation.ok) {
          return sendInvalidTaskList(reply, validation);
        }
        submittedTasks = validation.tasks;
      }
      if (current_task !== undefined && current_task !== null && typeof current_task !== "string") {
        return sendAgentClientError(
          reply,
          400,
          "invalid-current-task",
          "'current_task' must be a string or null.",
          "Send current_task as a short string, null, or omit it.",
          {},
          "'current_task' must be a string or null"
        );
      }

      const forbiddenFields: Array<keyof RegisterBody> = [
        "label",
        "parent_label",
        "parent_session",
        "project_slug",
        "session"
      ];
      for (const field of forbiddenFields) {
        if (request.body && request.body[field] !== undefined) {
          return reply.code(422).send({
            ok: false,
            error: "forbidden-derived-field",
            code: "forbidden-derived-field",
            message: `Attach registration rejected forbidden derived field '${field}'.`,
            hint: `identity is derived server-side; do not send ${field} — see GET /api/overmind/register/describe`,
            field
          });
        }
      }

      if (!path.isAbsolute(run_dir)) {
        return sendAgentClientError(
          reply,
          400,
          "invalid-run-dir",
          `'run_dir' must be an absolute path. Got: '${run_dir}'.`,
          "Use the canonical absolute path on disk; relative paths are ambiguous because overmind and the caller may have different cwds.",
          {},
          `'run_dir' must be an absolute path. Got: '${run_dir}'. Use the canonical path on disk; relative paths are ambiguous because overmind and the caller may have different cwds.`
        );
      }

      const match = await overmindService.findProjectForRunDir(run_dir);
      if (!match.project) {
        const validProjects = validProjectsForRegister(overmindService);
        return reply.code(404).send({
          ok: false,
          error: "no-project-for-run-dir",
          code: "no-project-for-run-dir",
          message: `No registered overmind project contains run_dir '${match.run_dir}'.`,
          run_dir: match.run_dir,
          searched_up_to: match.searched_up_to,
          hint: `your run_dir ${match.run_dir} is not under any registered project; valid projects: ${validProjects.map((project) => `${project.slug} (${project.app_path})`).join(", ") || "none"}; use the correct run_dir or ask JROM to create the project`,
          validProjects
        });
      }

      const existingWorkflow = overmindService.getByProjectRunDir(match.project.id, match.run_dir);
      let workflow = overmindService.registerAttached({
        project_id: match.project.id,
        label: `${match.project.slug} · ${path.basename(match.run_dir) || "run"}`,
        run_dir: match.run_dir,
        coordinator_session: match.project.parent_session,
        current_task,
        tasks: submittedTasks
      });
      let parentStatus: OvermindParentStatus = "unknown";
      let liveParent = match.project.parent_session;
      try {
        const resolution = await resolveParentSession(match.project.parent_session);
        liveParent = resolution.session ?? match.project.parent_session;
      } catch {
        liveParent = match.project.parent_session;
      }
      try {
        parentStatus = normalizeRegisterParentStatus(await isAgentPane(liveParent));
      } catch {
        parentStatus = "unknown";
      }
      workflow = overmindService.update(workflow.id, { parent_status: parentStatus }) ?? workflow;
      const parentWarning = parentWarningFor(parentStatus, match.project.parent_session);
      if (!existingWorkflow) {
        streamManager?.broadcast(undefined, {
          kind: "overmind-registration",
          project_slug: match.project.slug,
          workflow_id: workflow.id,
          label: workflow.label,
          run_dir: workflow.run_dir,
          at: new Date().toISOString()
        });
      }

      return reply.code(201).send({
        workflow,
        workflow_id: workflow.id,
        project_id: match.project.id,
        project_slug: match.project.slug,
        parent_session: match.project.parent_session,
        parent_status: parentStatus,
        ...(liveParent !== match.project.parent_session ? { resolved_session: liveParent } : {}),
        ...(parentWarning ? { parent_warning: parentWarning } : {})
      });
    }
  );

  app.post<{ Body: CompleteBody }>(
    "/api/overmind/complete",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { workflow_id, run_dir, session } = request.body || {};
      if (!hasWorkflowLookupKey({ workflow_id, run_dir, session })) {
        return sendAgentClientError(
          reply,
          400,
          "missing-workflow-lookup",
          "workflow_id, run_dir, or session is required.",
          "Address the workflow by workflow_id, canonical run_dir, or the legacy session fallback.",
          {},
          "workflow_id, run_dir, or session is required"
        );
      }

      const workflow = await overmindService.findWorkflow({ workflow_id, run_dir, session });
      if (!workflow) {
        return sendAgentClientError(
          reply,
          404,
          "workflow-not-found",
          "Workflow not found.",
          "Use the workflow_id returned by /register, the canonical run_dir, or re-register before completing.",
          {},
          "Workflow not found"
        );
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
      if (!hasWorkflowLookupKey({ workflow_id, run_dir, session }) || tasks === undefined) {
        return sendAgentClientError(
          reply,
          400,
          "missing-task-update-fields",
          "workflow_id, run_dir, or session and tasks are required.",
          "Send one workflow lookup key plus tasks: [{id,label,state}].",
          {},
          "workflow_id, run_dir, or session and tasks are required"
        );
      }
      if (current_task !== undefined && current_task !== null && typeof current_task !== "string") {
        return sendAgentClientError(
          reply,
          400,
          "invalid-current-task",
          "'current_task' must be a string or null.",
          "Send current_task as a short string, null, or omit it.",
          {},
          "'current_task' must be a string or null"
        );
      }
      const validation = validateSubmittedTaskList(tasks);
      if (!validation.ok) {
        return sendInvalidTaskList(reply, validation);
      }

      const workflow = await overmindService.findWorkflow({ workflow_id, run_dir, session });
      if (!workflow) {
        return sendAgentClientError(
          reply,
          404,
          "workflow-not-found",
          "Workflow not found.",
          "Use the workflow_id returned by /register, the canonical run_dir, or re-register before updating tasks.",
          {},
          "Workflow not found"
        );
      }

      return { workflow: overmindService.setTasks(workflow.id, current_task ?? null, validation.tasks) };
    }
  );

  app.post<{ Body: ChildrenBody }>(
    "/api/overmind/children",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { workflow_id, run_dir, session, child_sessions, child_roles } = request.body || {};
      if (!hasWorkflowLookupKey({ workflow_id, run_dir, session })) {
        return sendAgentClientError(
          reply,
          400,
          "missing-workflow-lookup",
          "workflow_id, run_dir, or session is required.",
          "Address the workflow by workflow_id, canonical run_dir, or the legacy session fallback.",
          {},
          "workflow_id, run_dir, or session is required"
        );
      }
      if (!Array.isArray(child_sessions)) {
        return sendAgentClientError(
          reply,
          400,
          "missing-child-sessions",
          "child_sessions is required.",
          "Send child_sessions as an array of tmux-safe session names.",
          {},
          "child_sessions is required"
        );
      }
      for (let i = 0; i < child_sessions.length; i++) {
        const childSession = child_sessions[i];
        if (typeof childSession !== "string" || !SESSION_NAME_RE.test(childSession)) {
          return sendInvalidSessionName(reply, `child_sessions[${i}]`, childSession);
        }
      }
      if (child_roles !== undefined && !Array.isArray(child_roles)) {
        return sendAgentClientError(
          reply,
          400,
          "invalid-child-roles",
          "child_roles must be an array.",
          "Omit child_roles or send an array whose length matches child_sessions.",
          {},
          "child_roles must be an array"
        );
      }
      const roles = child_roles ?? [];
      if (roles.length > 0 && roles.length !== child_sessions.length) {
        return sendAgentClientError(
          reply,
          400,
          "child-role-count-mismatch",
          `child_roles length (${roles.length}) must match child_sessions length (${child_sessions.length}).`,
          "Send one role per child session, or omit child_roles.",
          {},
          `child_roles length (${roles.length}) must match child_sessions length (${child_sessions.length})`
        );
      }

      const workflow = await overmindService.findWorkflow({ workflow_id, run_dir, session });
      if (!workflow) {
        return sendAgentClientError(
          reply,
          404,
          "workflow-not-found",
          "Workflow not found.",
          "Use the workflow_id returned by /register, the canonical run_dir, or re-register before updating children.",
          {},
          "Workflow not found"
        );
      }

      return { workflow: overmindService.setChildren(workflow.id, child_sessions, roles) };
    }
  );

  app.get<{ Querystring: { status?: OvermindWorkflowStatus } }>(
    "/api/overmind/workflows",
    { preHandler: authMiddleware },
    async (request) => {
      return { workflows: augmentWorkflowSparkHealth(overmindService.list(request.query.status)) };
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
        return sendAgentClientError(
          reply,
          400,
          "invalid-workflow-id",
          "Invalid workflow id.",
          "Use the numeric workflow_id returned by /register in the URL path.",
          {},
          "Invalid workflow id"
        );
      }

      // projcore RELAY of a JROM-initiated pause. projcore must never call this on its own
      // initiative (see projcore.md §2.11) — only when JROM explicitly tells it to.
      const workflow = overmindService.setMonitoringPaused(id, true, "projcore-relay");
      if (!workflow) {
        return sendAgentClientError(
          reply,
          404,
          "workflow-not-found",
          "Workflow not found.",
          "Use the numeric workflow_id returned by /register, or re-register before pausing.",
          {},
          "Workflow not found"
        );
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
        return sendAgentClientError(
          reply,
          400,
          "invalid-workflow-id",
          "Invalid workflow id.",
          "Use the numeric workflow_id returned by /register in the URL path.",
          {},
          "Invalid workflow id"
        );
      }

      const workflow = overmindService.setMonitoringPaused(id, false, null);
      if (!workflow) {
        return sendAgentClientError(
          reply,
          404,
          "workflow-not-found",
          "Workflow not found.",
          "Use the numeric workflow_id returned by /register, or re-register before resuming.",
          {},
          "Workflow not found"
        );
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
