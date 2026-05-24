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
      const query = request.query as Record<string, string>;
      const includeArchived = query.archived === "true";
      // JROM 2026-05-24: list is dynamic — reconcile against disk on every GET
      // so newly-created folders surface immediately and deleted folders
      // auto-archive (no manual cleanup). Caller can pass `?skipReconcile=true`
      // to bypass when the disk state is known fresh.
      let reconcile: { added: number; archived: number; reactivated: number } | undefined;
      if (query.skipReconcile !== "true") {
        try {
          reconcile = projectService.scanAndSync();
        } catch (err) {
          // disk hiccup shouldn't block the list — surface but don't fail.
          request.log.warn({ err }, "project scanAndSync failed");
        }
      }
      return {
        projects: projectService.list(includeArchived),
        ...(reconcile ? { reconcile } : {})
      };
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

      const reconcile = projectService.scanAndSync();

      auditService.log({
        userId: request.sessionUser!.id,
        actionType: "project_refresh",
        resourceType: "project",
        details: reconcile,
        surface: "web"
      });

      // `added` kept for backward-compat with existing callers.
      return { added: reconcile.added, reconcile, projects: projectService.list() };
    }
  );
}
