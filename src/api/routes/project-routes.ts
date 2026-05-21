import { FastifyInstance } from "fastify";
import { ProjectService } from "../../services/project-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { AuditService } from "../../services/audit-service.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  authService: AuthService,
  projectService: ProjectService,
  auditService: AuditService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get(
    "/api/projects",
    { preHandler: authMiddleware },
    async (request) => {
      const includeArchived = (request.query as Record<string, string>).archived === "true";
      return { projects: projectService.list(includeArchived) };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const project = projectService.getById(Number(request.params.id));
      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }
      return { project: { ...project, fullPath: projectService.getFullPath(project) } };
    }
  );

  app.patch<{ Params: { id: string }; Body: { display_name?: string; status?: "active" | "archived"; active?: number } }>(
    "/api/projects/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const project = projectService.update(Number(request.params.id), request.body || {});
      if (!project) {
        return reply.code(404).send({ error: "Project not found" });
      }

      auditService.log({
        userId: request.sessionUser.id,
        actionType: "project_update",
        resourceType: "project",
        resourceId: String(project.id),
        details: request.body,
        surface: "web"
      });

      return { project };
    }
  );

  app.post(
    "/api/projects/refresh",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const added = projectService.scanAndSync();

      auditService.log({
        userId: request.sessionUser!.id,
        actionType: "project_refresh",
        resourceType: "project",
        details: { added },
        surface: "web"
      });

      return { added, projects: projectService.list() };
    }
  );
}
