import { FastifyInstance } from "fastify";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { getAgentList } from "../../services/agent-registry-service.js";

export function registerAgentRoutes(
  app: FastifyInstance,
  authService: AuthService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/agents",
    { preHandler: authMiddleware },
    async () => {
      return { agents: getAgentList() };
    }
  );
}
