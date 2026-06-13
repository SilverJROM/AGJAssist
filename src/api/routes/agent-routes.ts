import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AgentAssignmentService, AGENT_ROLES, type AgentRole } from "../../services/agent-assignment-service.js";
import { CoordinatorLaunchService } from "../../services/coordinator-launch-service.js";
import { TmuxService } from "../../tmux/tmux-service.js";
import { ProjectService } from "../../services/project-service.js";

function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const v = String(ip).trim();
  if (v === "127.0.0.1" || v === "::1" || v === "::ffff:127.0.0.1") return true;
  if (v.startsWith("127.")) return true;
  return false;
}

function requireLocalLaunch(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  // Security: direct socket addr primary (resists xff spoof); fallback for proxies. Scoped ONLY to spawn/launch path.
  // App remains bound to config.api.host (0.0.0.0) so remote/tunnel UI access to dashboard/other APIs is unaffected.
  const direct = (request.raw as any)?.socket?.remoteAddress || (request.raw as any)?.connection?.remoteAddress;
  const ip = direct || request.ip || String((request.headers["x-forwarded-for"] as string) || "").split(",")[0].trim();
  if (!isLoopbackAddress(ip)) {
    reply.code(403).send({ error: "Launch/spawn endpoints only reachable from localhost" });
    return;
  }
  done();
}

export function registerAgentRoutes(
  app: FastifyInstance,
  authService: AuthService,
  agentAssignmentService: AgentAssignmentService,
  coordinatorLaunchService?: CoordinatorLaunchService,
  tmuxService?: TmuxService,
  projectService?: ProjectService
): void {
  const authMiddleware = createAuthMiddleware(authService);
  const tmux = tmuxService;
  const projects = projectService;

  app.get(
    "/api/agents",
    { preHandler: authMiddleware },
    async () => {
      return { agents: agentAssignmentService.listAgents() };
    }
  );

  app.post<{
    Body: { name: string; provider: string; model: string; default_effort?: string };
  }>(
    "/api/agents",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        const agent = agentAssignmentService.createAgent(request.body || {});
        return reply.code(201).send({ agent });
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: string; provider?: string; model?: string; default_effort?: string };
  }>(
    "/api/agents/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        const agent = agentAssignmentService.updateAgent(Number(request.params.id), request.body || {});
        if (!agent) {
          return reply.code(404).send({ error: "Agent not found" });
        }
        return { agent };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/agents/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        const deleted = agentAssignmentService.deleteAgent(Number(request.params.id));
        if (!deleted) {
          return reply.code(404).send({ error: "Agent not found" });
        }
        return reply.code(204).send();
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/role-bindings",
    { preHandler: authMiddleware },
    async (request) => {
      return {
        bindings: agentAssignmentService.listProjectBindings(Number(request.params.projectId))
      };
    }
  );

  app.get<{ Params: { projectId: string; role: string } }>(
    "/api/projects/:projectId/role-bindings/:role",
    { preHandler: authMiddleware },
    async (request, reply) => {
      try {
        return {
          binding: agentAssignmentService.getProjectBinding(
            Number(request.params.projectId),
            request.params.role
          )
        };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.put<{
    Params: { projectId: string; role: string };
    Body: { agent_id: number };
  }>(
    "/api/projects/:projectId/role-bindings/:role",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        const binding = agentAssignmentService.setProjectBinding(
          Number(request.params.projectId),
          request.params.role,
          Number(request.body?.agent_id)
        );
        return { binding };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.delete<{ Params: { projectId: string; role: string } }>(
    "/api/projects/:projectId/role-bindings/:role",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        agentAssignmentService.clearProjectBinding(
          Number(request.params.projectId),
          request.params.role
        );
        return reply.code(204).send();
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.get(
    "/api/role-defaults",
    { preHandler: authMiddleware },
    async () => {
      return { defaults: agentAssignmentService.listRoleDefaults() };
    }
  );

  app.get<{ Params: { role: string } }>(
    "/api/role-defaults/:role",
    { preHandler: authMiddleware },
    async (request, reply) => {
      try {
        return { default: agentAssignmentService.getRoleDefault(request.params.role) };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.put<{
    Params: { role: string };
    Body: { agent_id: number };
  }>(
    "/api/role-defaults/:role",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        const roleDefault = agentAssignmentService.setRoleDefault(
          request.params.role,
          Number(request.body?.agent_id)
        );
        return { default: roleDefault };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  app.get<{ Params: { projectId: string; role: string } }>(
    "/api/projects/:projectId/roles/:role/resolve",
    { preHandler: authMiddleware },
    async (request, reply) => {
      try {
        return {
          resolved: agentAssignmentService.resolveProjectRole(
            Number(request.params.projectId),
            request.params.role
          )
        };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  // B6 spawn-path guardrails (R24/R15 atop B3): (a) TG allowlist in core; (b) loopback preHandler scoped ONLY here (app host untouched); (c) enum role from AGENT_ROLES + existing project + launch_cmd from A2 resolver only (no free-form).
  app.post<{
    Params: { projectId: string };
    Body: { mode: string };
  }>(
    "/api/projects/:projectId/launch",
    { preHandler: [authMiddleware, requireOwner, requireLocalLaunch] },
    async (request, reply) => {
      try {
        if (!coordinatorLaunchService) {
          return reply.code(500).send({ error: "Launcher not configured" });
        }
        const projectId = Number(request.params.projectId);

        // (b) already enforced by requireLocalLaunch preHandler (non-loopback -> 403)

        const body = (request.body || {}) as Record<string, unknown>;
        const mode = String(body.mode || "");

        // (c) reject any free-form/shell/provider/cmd payload from request (or TG bridge); only enumerated role
        const forbidden = ["cmd", "command", "shell", "launch_cmd", "provider", "model", "prompt", "effort"];
        if (forbidden.some((k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] != null)) {
          return reply.code(400).send({ error: "free-form payload not allowed; only enumerated role (mode) accepted for spawn" });
        }

        // (c) role must be in the 10 AGJ roles (A1 registry)
        if (!(AGENT_ROLES as readonly string[]).includes(mode)) {
          return reply.code(400).send({ error: "role is invalid" });
        }

        // (c) project must exist in tracked projects
        if (projects) {
          const proj = projects.getById(projectId);
          if (!proj) {
            return reply.code(404).send({ error: "Project not found" });
          }
        }

        const result = await coordinatorLaunchService.launch(projectId, mode);
        return result;
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );

  // B4: talk/send to the project's coordinator session (R8 chat-half). Owner auth + requireOwner.
  // Reuses B3 session convention (agj-os-${projectId}) + tmux-service send-keys (no reimpl of substrate).
  // Optimistic echo is in frontend; this just delivers the keystrokes.
  app.post<{
    Params: { projectId: string };
    Body: { text: string; target?: string };
  }>(
    "/api/projects/:projectId/agent-message",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        if (!tmux) return reply.code(500).send({ error: "tmux service not available" });
        const projectId = Number(request.params.projectId);
        const text = (request.body?.text || "").trim();
        if (!text) return reply.code(400).send({ error: "text required" });
        const target = request.body?.target || `agj-os-${projectId}:0.0`;
        await tmux.sendAndSubmit(target, text);
        return { ok: true, runId: `agj-os-${projectId}`, target };
      } catch (err) {
        return sendAgentError(reply, err);
      }
    }
  );
}

function sendAgentError(reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : "Agent request failed";
  if (
    message.includes("is required") ||
    message.includes("must be") ||
    message.includes("invalid")
  ) {
    return reply.code(400).send({ error: message });
  }
  if (message.includes("UNIQUE constraint failed")) {
    return reply.code(409).send({ error: "Agent or role binding already exists" });
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    return reply.code(409).send({ error: "Referenced project or agent does not exist" });
  }
  return reply.code(500).send({ error: message });
}
