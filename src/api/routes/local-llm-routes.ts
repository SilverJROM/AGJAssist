import { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { ConversationService } from "../../services/conversation-service.js";
import { ChatSettingsService } from "../../services/chat-settings-service.js";
import { ToolRegistry } from "../../tools/tool-registry.js";
import { ToolAgent } from "../../orchestration/tool-agent.js";
import { LocalRelayProvider } from "../../llm/local-relay-provider.js";

interface RelayClient {
  id: string;
  name: string;
  model: string;
  format: string;
  connectedAt: string;
  socket: WebSocket;
  provider: LocalRelayProvider;
}

// Global registry of connected relay clients
const relayClients = new Map<string, RelayClient>();

export function registerLocalLlmRoutes(
  app: FastifyInstance,
  authService: AuthService,
  conversationService: ConversationService,
  chatSettingsService: ChatSettingsService,
  tools: ToolRegistry,
  maxIterations: number
): void {
  const authMiddleware = createAuthMiddleware(authService);

  // REST: Get connected relay clients
  app.get(
    "/api/local-llm/status",
    { preHandler: authMiddleware },
    async () => {
      const clients = Array.from(relayClients.values()).map(c => ({
        id: c.id,
        name: c.name,
        model: c.model,
        format: c.format,
        connectedAt: c.connectedAt
      }));
      return { clients, connected: clients.length > 0 };
    }
  );

  // REST: Send chat via local relay (same interface as /api/chat/send)
  app.post<{
    Body: {
      conversation_id: number;
      content: string;
      relay_client_id?: string;
    };
  }>(
    "/api/local-llm/chat",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { conversation_id, content, relay_client_id } = request.body || {};
      if (!conversation_id) return reply.code(400).send({ error: "conversation_id is required" });
      if (!content) return reply.code(400).send({ error: "content is required" });

      // Pick a relay client
      let client: RelayClient | undefined;
      if (relay_client_id) {
        client = relayClients.get(relay_client_id);
      } else {
        // Use first connected client
        client = relayClients.values().next().value as RelayClient | undefined;
      }

      if (!client) {
        return reply.code(503).send({ error: "No local LLM relay connected. Run the relay script on your machine." });
      }

      const conversation = conversationService.getById(conversation_id);
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

      // Build context (same as chat-routes.ts)
      const soulMd = chatSettingsService.get("soul_md");
      const contextMd = chatSettingsService.get("context_md");

      const history = conversation.messages
        .filter((msg: { role: string; content: string }) =>
          (msg.role === "user" || msg.role === "assistant") &&
          !msg.content.startsWith("Error:")
        )
        .slice(-20);

      const contextParts: string[] = [];
      if (soulMd) contextParts.push(soulMd);
      if (contextMd) contextParts.push(contextMd);
      if (history.length > 0) {
        contextParts.push(
          "Recent conversation history:",
          ...history.map((m: { role: string; content: string }) =>
            `${m.role}: ${m.content.slice(0, 500)}`
          )
        );
      }

      const fullRequest = contextParts.length > 0
        ? contextParts.join("\n\n") + "\n\nUser's latest message:\n" + content
        : content;

      // Save user message
      conversationService.addMessage(conversation_id, {
        role: "user",
        content,
        timestamp: new Date().toISOString()
      }, request.sessionUser.id);

      try {
        const agent = new ToolAgent(client.provider, tools, maxIterations);
        const responseText = await agent.run(fullRequest);
        const cleanResponse = responseText.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, "").trim();

        const updated = conversationService.addMessage(conversation_id, {
          role: "assistant",
          content: cleanResponse,
          timestamp: new Date().toISOString()
        }, request.sessionUser.id);

        return { conversation: updated };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        const updated = conversationService.addMessage(conversation_id, {
          role: "system",
          content: `Error: ${errorMessage}`,
          timestamp: new Date().toISOString()
        }, request.sessionUser.id);

        return { conversation: updated, error: errorMessage };
      }
    }
  );

  // WebSocket: Relay client connection
  app.get<{ Querystring: { token?: string } }>(
    "/ws/local-llm",
    { websocket: true },
    async (socket: WebSocket, request) => {
      const token = (request.query as Record<string, string>).token || "";
      const session = authService.verifyToken(token);
      if (!session || session.role !== "owner") {
        socket.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
        socket.close();
        return;
      }

      const provider = new LocalRelayProvider(socket);
      const clientId = crypto.randomUUID();

      // Wait for hello message with client info, or use defaults
      const client: RelayClient = {
        id: clientId,
        name: "Relay Client",
        model: "unknown",
        format: "unknown",
        connectedAt: new Date().toISOString(),
        socket,
        provider
      };

      relayClients.set(clientId, client);
      console.log(`Local LLM relay connected: ${clientId}`);

      socket.on("message", async (raw: Buffer | string) => {
        const data = raw.toString();

        // Forward inference responses to the provider
        if (provider.handleMessage(data)) return;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }

        // Client can send hello to identify itself
        if (msg.type === "hello") {
          client.name = String(msg.name || "Relay Client");
          client.model = String(msg.model || "unknown");
          client.format = String(msg.format || "unknown");
          console.log(`Relay client identified: ${client.name} (${client.model})`);
        }
      });

      socket.on("close", () => {
        provider.close();
        relayClients.delete(clientId);
        console.log(`Local LLM relay disconnected: ${clientId}`);
      });

      socket.on("error", () => {
        provider.close();
        relayClients.delete(clientId);
      });

      // Confirm connection
      socket.send(JSON.stringify({ type: "connected", clientId }));
    }
  );
}
