import { FastifyInstance } from "fastify";
import { ConversationService, Message } from "../../services/conversation-service.js";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";

export function registerConversationRoutes(
  app: FastifyInstance,
  authService: AuthService,
  conversationService: ConversationService
): void {
  const authMiddleware = createAuthMiddleware(authService);

  // List conversations (optionally filtered by project/agent)
  app.get(
    "/api/conversations",
    { preHandler: authMiddleware },
    async (request) => {
      const query = request.query as Record<string, string>;
      return {
        conversations: conversationService.list({
          projectId: query.projectId ? Number(query.projectId) : undefined,
          agentName: query.agentName,
          userId: request.sessionUser?.id
        })
      };
    }
  );

  // Get single conversation with messages
  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const conv = conversationService.getById(Number(request.params.id));
      if (!conv) return reply.code(404).send({ error: "Conversation not found" });
      return { conversation: conv };
    }
  );

  // Create new conversation
  app.post<{
    Body: { agentName: string; projectId?: number; message?: string };
  }>(
    "/api/conversations",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { agentName, projectId, message } = request.body || {};
      if (!agentName) {
        return reply.code(400).send({ error: "agentName is required" });
      }

      const conv = conversationService.create(
        agentName,
        request.sessionUser!.id,
        projectId,
        message
      );

      return reply.code(201).send({ conversation: conv });
    }
  );

  // Add message to conversation
  app.post<{
    Params: { id: string };
    Body: { role: "user" | "assistant" | "system"; content: string; metadata?: Record<string, unknown> };
  }>(
    "/api/conversations/:id/messages",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { role, content, metadata } = request.body || {};
      if (!role || !content) {
        return reply.code(400).send({ error: "role and content are required" });
      }

      const message: Message = {
        role,
        content,
        timestamp: new Date().toISOString(),
        metadata
      };

      const conv = conversationService.addMessage(
        Number(request.params.id),
        message,
        request.sessionUser?.id
      );

      if (!conv) return reply.code(404).send({ error: "Conversation not found" });
      return { conversation: conv };
    }
  );

  // Delete conversation
  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const deleted = conversationService.delete(
        Number(request.params.id),
        request.sessionUser.id
      );

      if (!deleted) return reply.code(404).send({ error: "Conversation not found" });
      return reply.code(204).send();
    }
  );
}
