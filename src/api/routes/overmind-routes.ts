import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppConfig } from "../../config/config.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import {
  OvermindService,
  OvermindTask,
  OvermindWorkflowStatus
} from "../../services/overmind-service.js";

interface TokenBody {
  token?: string;
}

interface RegisterBody extends TokenBody {
  label?: string;
  session?: string;
  child_sessions?: string[];
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

  if (!request.body?.token || request.body.token !== expectedToken) {
    reply.code(401).send({ error: "Missing or invalid overmind token" });
    return false;
  }

  return true;
}

export function registerOvermindRoutes(
  app: FastifyInstance,
  config: AppConfig,
  authService: AuthService,
  overmindService: OvermindService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{ Body: RegisterBody }>(
    "/api/overmind/register",
    async (request, reply) => {
      if (!requireLoopbackAndToken(request, reply, config.overmind.token)) return;

      const { label, session, child_sessions, run_dir, current_task, tasks } = request.body || {};
      if (!label || !session || !run_dir) {
        return reply.code(400).send({ error: "label, session, and run_dir are required" });
      }

      const workflow = overmindService.register({
        label,
        coordinator_session: session,
        child_sessions,
        run_dir,
        current_task,
        tasks
      });

      return reply.code(201).send({ workflow });
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

      return { workflow: overmindService.setStatus(workflow.id, "completed") };
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
}
