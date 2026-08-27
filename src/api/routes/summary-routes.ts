import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createAuthMiddleware, requireOwner } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { DatabaseService } from "../../db/database.js";
import { SummaryEndpointService } from "../../services/summary-endpoint-service.js";

function isOpenAICompatibleBaseUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    // Reject URLs with embedded credentials, query strings, or fragments
    if (url.username || url.password || url.search || url.hash) return false;
    // OpenAI-compatible base URL must end with /v1 or /v1/
    const path = url.pathname;
    return path === "/v1" || path === "/v1/";
  } catch {
    return false;
  }
}

export function registerSummaryRoutes(
  app: FastifyInstance,
  authService: AuthService,
  db: DatabaseService
): void {
  const authMiddleware = createAuthMiddleware(authService);
  const endpointService = new SummaryEndpointService(db);

  // List endpoints
  app.get(
    "/api/summary-endpoints",
    { preHandler: [authMiddleware, requireOwner] },
    async () => {
      const list = endpointService.list();
      return { endpoints: list };
    }
  );

  // Get endpoint by id
  app.get<{ Params: { id: string } }>(
    "/api/summary-endpoints/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const ep = endpointService.getById(id);
      if (!ep) return reply.code(404).send({ error: "Endpoint not found" });
      return { endpoint: ep };
    }
  );

  // Create endpoint
  app.post<{ Body: { name: string; base_url: string; model: string; provenance?: string } }>(
    "/api/summary-endpoints",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const body = request.body;
      if (!body?.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "name is required" });
      }
      if (!body?.base_url || typeof body.base_url !== "string") {
        return reply.code(400).send({ error: "base_url is required" });
      }
      if (!isOpenAICompatibleBaseUrl(body.base_url)) {
        return reply.code(400).send({ error: "base_url must be a valid http(s) URL ending with /v1" });
      }
      if (!body?.model || typeof body.model !== "string") {
        return reply.code(400).send({ error: "model is required" });
      }

      try {
        const created = endpointService.create({
          name: body.name,
          base_url: body.base_url,
          model: body.model,
          provenance: body.provenance,
        });
        // Do not log base_url or secrets
        return reply.code(201).send({ endpoint: created });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    }
  );

  // Update endpoint
  app.patch<{ Params: { id: string }; Body: { name?: string; base_url?: string; model?: string } }>(
    "/api/summary-endpoints/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const body = request.body;
      if (body?.base_url) {
        if (typeof body.base_url !== "string" || !isOpenAICompatibleBaseUrl(body.base_url)) {
          return reply.code(400).send({ error: "base_url must be a valid http(s) URL ending with /v1" });
        }
      }
      const updated = endpointService.update(id, {
        name: body?.name,
        base_url: body?.base_url,
        model: body?.model,
      });
      if (!updated) return reply.code(404).send({ error: "Endpoint not found" });
      return { endpoint: updated };
    }
  );

  // Delete endpoint
  app.delete<{ Params: { id: string } }>(
    "/api/summary-endpoints/:id",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const ok = endpointService.remove(id);
      if (!ok) {
        const ep = endpointService.getById(id);
        if (!ep) return reply.code(404).send({ error: "Endpoint not found" });
        return reply.code(400).send({ error: "Cannot remove default endpoint" });
      }
      return reply.code(204).send();
    }
  );

  // Set default endpoint
  app.post<{ Params: { id: string } }>(
    "/api/summary-endpoints/:id/default",
    { preHandler: [authMiddleware, requireOwner] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const ep = endpointService.getById(id);
      if (!ep) return reply.code(404).send({ error: "Endpoint not found" });
      const updated = endpointService.setDefault(id);
      if (!updated) return reply.code(500).send({ error: "Failed to set default" });
      return { endpoint: updated };
    }
  );

  // Per-agent summaries newest first
  app.get<{ Params: { agentName: string } }>(
    "/api/summary-agents/:agentName/summaries",
    { preHandler: [authMiddleware, requireOwner] },
    async (request) => {
      const agentName = request.params.agentName;
      const rows = db.prepare(
        `SELECT id, agent_name, endpoint_id, summary_text, provenance, created_at, updated_at
         FROM agent_summaries
         WHERE agent_name = ?
         ORDER BY created_at DESC, id DESC`
      ).all(agentName) as any[];
      return { summaries: rows };
    }
  );
}
