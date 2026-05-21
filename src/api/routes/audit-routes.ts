import { FastifyInstance } from "fastify";
import { AuditService } from "../../services/audit-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerAuditRoutes(
  app: FastifyInstance,
  authService: AuthService,
  auditService: AuditService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/audit",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;
      return {
        entries: auditService.query({
          actionType: query.action_type,
          resourceType: query.resource_type,
          agentName: query.agent_name,
          userId: query.user_id ? Number(query.user_id) : undefined,
          since: query.since,
          until: query.until,
          limit: query.limit ? Number(query.limit) : undefined,
          offset: query.offset ? Number(query.offset) : undefined
        })
      };
    }
  );
}
