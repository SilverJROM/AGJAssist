import { FastifyInstance } from "fastify";
import { DelegationService } from "../../services/delegation-service.js";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerDelegationRoutes(
  app: FastifyInstance,
  authService: AuthService,
  delegationService: DelegationService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/delegations",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;
      return {
        delegations: delegationService.listActive({
          agentName: query.agent_name,
          tmuxSessionId: query.tmux_session_id ? Number(query.tmux_session_id) : undefined
        })
      };
    }
  );

  app.post<{
    Body: {
      agent_name: string;
      tmux_session_id: number;
      pane_target?: string;
      authority: "observe" | "suggest" | "execute";
    };
  }>(
    "/api/delegations",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { agent_name, tmux_session_id, pane_target, authority } = request.body || {};

      if (!agent_name || !tmux_session_id || !authority) {
        return reply
          .code(400)
          .send({ error: "agent_name, tmux_session_id, and authority are required" });
      }

      if (!["observe", "suggest", "execute"].includes(authority)) {
        return reply
          .code(400)
          .send({ error: "authority must be observe, suggest, or execute" });
      }

      const delegation = delegationService.grant(
        agent_name,
        tmux_session_id,
        pane_target || null,
        authority,
        request.sessionUser!.id
      );

      return reply.code(201).send({ delegation });
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { authority: "observe" | "suggest" | "execute" };
  }>(
    "/api/delegations/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const { authority } = request.body || {};

      if (!authority || !["observe", "suggest", "execute"].includes(authority)) {
        return reply
          .code(400)
          .send({ error: "authority must be observe, suggest, or execute" });
      }

      const updated = delegationService.changeAuthority(
        Number(request.params.id),
        authority,
        request.sessionUser!.id
      );

      if (!updated) {
        return reply.code(404).send({ error: "Active delegation not found" });
      }

      return { delegation: updated };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/delegations/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const revoked = delegationService.revoke(
        Number(request.params.id),
        request.sessionUser!.id
      );

      if (!revoked) {
        return reply.code(404).send({ error: "Active delegation not found" });
      }

      return reply.code(204).send();
    }
  );

  app.get<{ Params: { agentName: string } }>(
    "/api/delegations/agent/:agentName",
    { preHandler: authMiddleware },
    async (request) => {
      return {
        delegations: delegationService.listActive({
          agentName: request.params.agentName
        })
      };
    }
  );
}
