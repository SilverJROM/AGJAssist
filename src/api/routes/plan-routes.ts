import { FastifyInstance } from "fastify";
import { PlanService } from "../../services/plan-service.js";
import { ProjectService } from "../../services/project-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerPlanRoutes(
  app: FastifyInstance,
  authService: AuthService,
  planService: PlanService,
  projectService: ProjectService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/plans",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;
      return {
        plans: planService.list(Number(request.params.projectId), query.status)
      };
    }
  );

  app.post<{
    Params: { projectId: string };
    Body: { title: string; description?: string };
  }>(
    "/api/projects/:projectId/plans",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { title, description } = request.body || {};
      if (!title) return reply.code(400).send({ error: "title is required" });

      const plan = planService.create(
        Number(request.params.projectId),
        title,
        description || null,
        request.sessionUser.id
      );

      return reply.code(201).send({ plan });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/plans/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const plan = planService.getById(Number(request.params.id));
      if (!plan) return reply.code(404).send({ error: "Plan not found" });
      return { plan };
    }
  );

  app.patch<{
    Params: { id: string };
    Body: { title?: string; description?: string; status?: string };
  }>(
    "/api/plans/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const plan = planService.update(
        Number(request.params.id),
        request.body || {},
        request.sessionUser.id
      );

      if (!plan) return reply.code(404).send({ error: "Plan not found" });
      return { plan };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/plans/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = planService.delete(
        Number(request.params.id),
        request.sessionUser.id
      );

      if (!deleted) return reply.code(404).send({ error: "Plan not found" });
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string }; Body: { description: string } }>(
    "/api/plans/:id/steps",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { description } = request.body || {};
      if (!description) return reply.code(400).send({ error: "description is required" });

      const step = planService.addStep(Number(request.params.id), description);
      return reply.code(201).send({ step });
    }
  );

  app.patch<{
    Params: { id: string; stepId: string };
    Body: { description?: string; completed?: boolean; step_order?: number };
  }>(
    "/api/plans/:id/steps/:stepId",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const step = planService.updateStep(
        Number(request.params.stepId),
        request.body || {}
      );

      if (!step) return reply.code(404).send({ error: "Step not found" });
      return { step };
    }
  );

  // Get linked notes for a plan
  app.get<{ Params: { id: string } }>(
    "/api/plans/:id/notes",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const notes = planService.getLinkedNotes(Number(request.params.id));
      return { notes };
    }
  );

  // List plan folders in project
  app.get<{ Params: { id: string } }>(
    "/api/plans/:id/folders",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const plan = planService.getById(Number(request.params.id));
      if (!plan) return reply.code(404).send({ error: "Plan not found" });

      const project = projectService.getById(plan.project_id);
      if (!project) return reply.code(404).send({ error: "Project not found" });

      const projectRoot = projectService.getFullPath(project);
      const folders = planService.listPlanFolders(projectRoot);
      return { folders };
    }
  );

  // Insert plan to project filesystem
  app.post<{ Params: { id: string }; Body: { folder: string; createNew: boolean } }>(
    "/api/plans/:id/insert",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { folder, createNew } = request.body || {};
      if (!folder) return reply.code(400).send({ error: "folder is required" });

      const plan = planService.getById(Number(request.params.id));
      if (!plan) return reply.code(404).send({ error: "Plan not found" });

      const project = projectService.getById(plan.project_id);
      if (!project) return reply.code(404).send({ error: "Project not found" });

      const projectRoot = projectService.getFullPath(project);
      const result = planService.insertToProject(
        Number(request.params.id),
        projectRoot,
        folder,
        createNew !== false,
        request.sessionUser.id
      );

      if (!result) {
        return reply.code(400).send({ error: "Failed to insert plan. Folder may already exist or target is invalid." });
      }

      return { ok: true, path: result.path, folder: result.folderName };
    }
  );
}
