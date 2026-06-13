import { FastifyInstance } from "fastify";
import { AgentEventsStreamManager } from "../websocket/agent-events-stream-manager.js";

export function registerAgentEventsRoutes(
  app: FastifyInstance,
  streamManager: AgentEventsStreamManager
): void {
  app.get<{ Params: { runId: string }; Querystring: { token?: string } }>(
    "/ws/agent-events/:runId",
    { websocket: true },
    async (socket, request) => {
      const token = (request.query as Record<string, string>).token || "";
      await streamManager.handleConnection(socket, token, decodeURIComponent(request.params.runId));
    }
  );
}
