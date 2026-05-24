import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppConfig } from "../../config/config.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import {
  DuplicateRunDirError,
  OvermindService,
  OvermindTask,
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

interface SendBody {
  message?: string;
}

interface RegisterBody extends TokenBody {
  label?: string;
  session?: string;
  child_sessions?: string[];
  child_roles?: string[];
  run_dir?: string;
  current_task?: string | null;
  tasks?: OvermindTask[];
}

interface CompleteBody extends TokenBody {
  session?: string;
}

interface TasksBody extends TokenBody {
  session?: string;
  current_task?: string | null;
  tasks?: OvermindTask[];
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

function parseWorkflowId(id: string): number | null {
  const workflowId = Number(id);
  return Number.isInteger(workflowId) && workflowId >= 1 ? workflowId : null;
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

  app.post<{ Body: RegisterBody }>(
    "/api/overmind/register",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { label, session, child_sessions, child_roles, run_dir, current_task, tasks } = request.body || {};
      if (!label || !session || !run_dir) {
        return reply.code(400).send({ error: "label, session, and run_dir are required" });
      }

      try {
        const workflow = overmindService.register({
          label,
          coordinator_session: session,
          child_sessions,
          child_roles,
          run_dir,
          current_task,
          tasks
        });
        return reply.code(201).send({ workflow });
      } catch (err) {
        // Duplicate-run_dir collision: another active workflow already owns this run_dir
        // under a different coordinator_session (JROM's "1 workflow per parent session"
        // rule). Return 409 with the existing row so the caller can recover.
        if (err instanceof DuplicateRunDirError) {
          return reply.code(409).send({
            error: err.message,
            existing: {
              id: err.existing.id,
              coordinator_session: err.existing.coordinator_session,
              label: err.existing.label,
              run_dir: err.existing.run_dir,
              status: err.existing.status
            }
          });
        }
        throw err;
      }
    }
  );

  app.post<{ Body: CompleteBody }>(
    "/api/overmind/complete",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { session } = request.body || {};
      if (!session) {
        return reply.code(400).send({ error: "session is required" });
      }

      const workflow = overmindService.getBySession(session);
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
              await tmuxService.sendAndSubmit(completed.coordinator_session, msg);
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

      const { session, current_task, tasks } = request.body || {};
      if (!session || !Array.isArray(tasks)) {
        return reply.code(400).send({ error: "session and tasks are required" });
      }

      const workflow = overmindService.getBySession(session);
      if (!workflow) {
        return reply.code(404).send({ error: "Workflow not found" });
      }

      return { workflow: overmindService.setTasks(workflow.id, current_task ?? null, tasks) };
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

  app.delete<{ Params: WorkflowParams; Body: TokenBody }>(
    "/api/overmind/workflows/:id",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

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
        workflow = overmindService.setAskUpdateCooldownOverride(id, overrideMinutes ?? null);
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
