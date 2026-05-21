import { FastifyInstance } from "fastify";
import { TaskService } from "../../services/task-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerTaskRoutes(
  app: FastifyInstance,
  authService: AuthService,
  taskService: TaskService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/tasks",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;
      return {
        tasks: taskService.listByProject(Number(request.params.projectId), query.status)
      };
    }
  );

  app.get<{ Params: { planId: string } }>(
    "/api/plans/:planId/tasks",
    { preHandler: authMiddleware },
    async (request) => {
      return { tasks: taskService.listByPlan(Number(request.params.planId)) };
    }
  );

  app.post<{
    Params: { planId: string };
    Body: {
      project_id: number;
      plan_step_id?: number;
      title: string;
      description?: string;
      acceptance_criteria?: string;
      assigned_to?: string;
      tmux_session_id?: number;
    };
  }>(
    "/api/plans/:planId/tasks",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const body = request.body || {};
      if (!body.title || !body.project_id) {
        return reply.code(400).send({ error: "title and project_id are required" });
      }

      const task = taskService.create({
        planId: Number(request.params.planId),
        projectId: body.project_id,
        planStepId: body.plan_step_id,
        title: body.title,
        description: body.description,
        acceptanceCriteria: body.acceptance_criteria,
        assignedTo: body.assigned_to,
        tmuxSessionId: body.tmux_session_id
      });

      return reply.code(201).send({ task });
    }
  );

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      acceptance_criteria?: string;
      status?: string;
      assigned_to?: string;
      tmux_session_id?: number;
    };
  }>(
    "/api/tasks/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const task = taskService.update(
        Number(request.params.id),
        request.body || {},
        request.sessionUser.id
      );

      if (!task) return reply.code(404).send({ error: "Task not found" });
      return { task };
    }
  );

  app.post<{ Params: { id: string }; Body: { executor: string; tmux_session_id?: number } }>(
    "/api/tasks/:id/execute",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { executor, tmux_session_id } = request.body || {};
      if (!executor) return reply.code(400).send({ error: "executor is required" });

      const execution = taskService.startExecution(
        Number(request.params.id),
        executor,
        tmux_session_id
      );

      return reply.code(201).send({ execution });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/tasks/:id/executions",
    { preHandler: authMiddleware },
    async (request) => {
      return { executions: taskService.getExecutions(Number(request.params.id)) };
    }
  );
}
