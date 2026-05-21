import { FastifyInstance } from "fastify";
import { StepTemplateService } from "../../services/step-template-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerTemplateRoutes(
  app: FastifyInstance,
  authService: AuthService,
  stepTemplateService: StepTemplateService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  // List all templates
  app.get(
    "/api/templates",
    { preHandler: authMiddleware },
    async () => {
      return { templates: stepTemplateService.list() };
    }
  );

  // Create template
  app.post<{ Body: { name: string } }>(
    "/api/templates",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { name } = request.body || {};
      if (!name) return reply.code(400).send({ error: "name is required" });

      const template = stepTemplateService.create(name, request.sessionUser.id);
      return reply.code(201).send({ template });
    }
  );

  // Get template by ID
  app.get<{ Params: { id: string } }>(
    "/api/templates/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const template = stepTemplateService.getById(Number(request.params.id));
      if (!template) return reply.code(404).send({ error: "Template not found" });
      return { template };
    }
  );

  // Update template name
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/templates/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { name } = request.body || {};
      if (!name) return reply.code(400).send({ error: "name is required" });

      const template = stepTemplateService.updateName(
        Number(request.params.id),
        name,
        request.sessionUser.id
      );

      if (!template) return reply.code(404).send({ error: "Template not found" });
      return { template };
    }
  );

  // Delete template
  app.delete<{ Params: { id: string } }>(
    "/api/templates/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = stepTemplateService.delete(
        Number(request.params.id),
        request.sessionUser.id
      );

      if (!deleted) return reply.code(404).send({ error: "Template not found" });
      return { ok: true };
    }
  );

  // Add item to template
  app.post<{ Params: { id: string }; Body: { description: string } }>(
    "/api/templates/:id/items",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { description } = request.body || {};
      if (!description) return reply.code(400).send({ error: "description is required" });

      const item = stepTemplateService.addItem(Number(request.params.id), description);
      return reply.code(201).send({ item });
    }
  );

  // Update template item
  app.patch<{
    Params: { id: string; itemId: string };
    Body: { description?: string; item_order?: number };
  }>(
    "/api/templates/:id/items/:itemId",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const item = stepTemplateService.updateItem(
        Number(request.params.itemId),
        request.body || {}
      );

      if (!item) return reply.code(404).send({ error: "Item not found" });
      return { item };
    }
  );

  // Delete template item
  app.delete<{ Params: { id: string; itemId: string } }>(
    "/api/templates/:id/items/:itemId",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = stepTemplateService.deleteItem(Number(request.params.itemId));
      if (!deleted) return reply.code(404).send({ error: "Item not found" });
      return { ok: true };
    }
  );

  // Apply template to plan
  app.post<{ Params: { planId: string }; Body: { template_id: number } }>(
    "/api/plans/:planId/apply-template",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { template_id } = request.body || {};
      if (!template_id) return reply.code(400).send({ error: "template_id is required" });

      const result = stepTemplateService.applyToPlan(template_id, Number(request.params.planId));
      return { ok: true, addedCount: result.addedCount };
    }
  );

  // Create template from plan
  app.post<{ Body: { plan_id: number; name: string } }>(
    "/api/templates/from-plan",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { plan_id, name } = request.body || {};
      if (!plan_id || !name) {
        return reply.code(400).send({ error: "plan_id and name are required" });
      }

      const template = stepTemplateService.createFromPlan(
        plan_id,
        name,
        request.sessionUser.id
      );

      if (!template) return reply.code(404).send({ error: "Plan not found" });
      return reply.code(201).send({ template });
    }
  );
}
