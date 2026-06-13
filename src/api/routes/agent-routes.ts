import { FastifyInstance, FastifyReply } from "fastify";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AgentAssignmentService } from "../../services/agent-assignment-service.js";
import { CoordinatorLaunchService } from "../../services/coordinator-launch-service.js";

export function registerAgentRoutes(
  app: FastifyInstance,
  authService: AuthService,
  agentAssignmentService: AgentAssignmentService,
  coordinatorLaunchService?: CoordinatorLaunchService
): void {
  const authMiddleware = createAuthMiddleware(authService);

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

  // B3 launcher (R9/R5/R7): behind EXISTING owner auth (affirmation #1). Mode selects CORE + binding (affirmation #2).
  app.post<{
    Params: { projectId: string };
    Body: { mode: string };
  }>(
    "/api/projects/:projectId/launch",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      try {
        if (!coordinatorLaunchService) {
          return reply.code(500).send({ error: "Launcher not configured" });
        }
        const projectId = Number(request.params.projectId);
        const mode = (request.body?.mode || "") as "projcore" | "coord";
        const result = await coordinatorLaunchService.launch(projectId, mode);
        return result;
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
