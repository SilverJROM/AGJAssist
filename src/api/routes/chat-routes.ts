import { FastifyInstance } from "fastify";
import path from "node:path";
import { createAuthMiddleware } from "../../auth/auth-middleware.js";
import { AuthService } from "../../auth/auth-service.js";
import { OllamaProvider } from "../../llm/ollama-provider.js";
import { OpenRouterProvider } from "../../llm/openrouter-provider.js";
import { ClaudeCliProvider } from "../../llm/claude-cli-provider.js";
import { CodexCliProvider } from "../../llm/codex-cli-provider.js";
import { ConversationService } from "../../services/conversation-service.js";
import { ChatSettingsService } from "../../services/chat-settings-service.js";
import { ToolAgent } from "../../orchestration/tool-agent.js";
import { ToolRegistry } from "../../tools/tool-registry.js";

export function registerChatRoutes(
  app: FastifyInstance,
  authService: AuthService,
  ollama: OllamaProvider,
  openRouter: OpenRouterProvider,
  conversationService: ConversationService,
  chatSettingsService: ChatSettingsService,
  ollamaAgent: ToolAgent,
  openRouterAgent: ToolAgent,
  claudeCliProvider: ClaudeCliProvider,
  codexCliProvider: CodexCliProvider,
  tools: ToolRegistry,
  maxToolIterations: number
): void {
  const authMiddleware = createAuthMiddleware(authService);

  app.post<{
    Body: {
      conversation_id: number;
      content: string;
      provider: "ollama" | "openrouter" | "local" | "claude" | "codex";
      model?: string;
      cwd?: string;
    };
  }>(
    "/api/chat/send",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { conversation_id, content, provider, model, cwd: requestCwd } = request.body || {};
      if (!conversation_id) return reply.code(400).send({ error: "conversation_id is required" });
      if (!content) return reply.code(400).send({ error: "content is required" });
      if (!provider) return reply.code(400).send({ error: "provider is required" });
      if (provider === "local") return reply.code(400).send({ error: "Local provider uses WebSocket relay. Connect via the browser." });

      const conversation = conversationService.getById(conversation_id);
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

      // Resolve cwd: request body > conversation stored > default
      const WEBSITES_ROOT = "/home/agjrom/websites";
      let convCwd = requestCwd || conversationService.getCwd(conversation_id) || WEBSITES_ROOT;
      // Ensure cwd stays within /home/agjrom/websites/
      const resolvedCwd = path.resolve(convCwd);
      if (!resolvedCwd.startsWith(WEBSITES_ROOT)) {
        convCwd = WEBSITES_ROOT;
      } else {
        convCwd = resolvedCwd;
      }
      // Store cwd on conversation if changed
      if (requestCwd) {
        conversationService.setCwd(conversation_id, convCwd);
      }

      const soulMd = chatSettingsService.get("soul_md");
      const contextMd = chatSettingsService.get("context_md");

      // Build context from recent conversation history
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
        let responseText: string;

        if (provider === "claude") {
          // Use Claude CLI with session continuity
          if (model) claudeCliProvider.setModel(model);
          const existingSessionId = conversationService.getCliSessionId(conversation_id);
          const result = await claudeCliProvider.chatWithSession(
            [{ role: "system", content: [soulMd, contextMd].filter(Boolean).join("\n\n") || "Be concise." },
             ...history.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })),
             { role: "user", content }],
            undefined,
            existingSessionId || undefined,
            convCwd
          );
          responseText = result.content;
          if (result.sessionId) {
            conversationService.setCliSessionId(conversation_id, result.sessionId);
          }
        } else if (provider === "codex") {
          // Use Codex CLI with session continuity
          const existingSessionId = conversationService.getCliSessionId(conversation_id);
          const result = await codexCliProvider.chatWithSession(
            [{ role: "system", content: [soulMd, contextMd].filter(Boolean).join("\n\n") || "Be concise." },
             ...history.map((m: { role: string; content: string }) => ({ role: m.role as "user" | "assistant", content: m.content })),
             { role: "user", content }],
            undefined,
            existingSessionId || undefined,
            convCwd
          );
          responseText = result.content;
          if (result.sessionId) {
            conversationService.setCliSessionId(conversation_id, result.sessionId);
          }
        } else {
          // Ollama / OpenRouter — use ToolAgent (enables tool calling)
          const agent = provider === "ollama" ? ollamaAgent : openRouterAgent;
          responseText = await agent.run(fullRequest);
        }

        // Strip any leftover <ACTION> blocks from final response
        const cleanResponse = responseText.replace(/<ACTION>[\s\S]*?<\/ACTION>/g, "").trim();

        const updated = conversationService.addMessage(conversation_id, {
          role: "assistant",
          content: cleanResponse,
          timestamp: new Date().toISOString()
        }, request.sessionUser.id);

        return { conversation: updated };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown LLM error";

        const updated = conversationService.addMessage(conversation_id, {
          role: "system",
          content: `Error: ${errorMessage}`,
          timestamp: new Date().toISOString()
        }, request.sessionUser.id);

        return { conversation: updated, error: errorMessage };
      }
    }
  );

  app.get(
    "/api/chat/models",
    { preHandler: authMiddleware },
    async () => {
      return {
        models: [
          { id: "ollama", name: "Ollama (Server)", description: "LLM via server-side Ollama" },
          { id: "openrouter", name: "OpenRouter", description: "Cloud LLM via OpenRouter" },
          { id: "claude", name: "Claude Code", description: "Anthropic Claude via CLI (subscription)" },
          { id: "codex", name: "Codex", description: "OpenAI Codex via CLI (subscription)" },
          { id: "local", name: "Local LLM (Relay)", description: "Local LLM via relay script" }
        ]
      };
    }
  );

  // List available models for a specific provider
  app.get<{ Params: { provider: string } }>(
    "/api/chat/models/:provider",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { provider } = request.params;

      if (provider === "ollama") {
        try {
          const baseUrl = ollama.getBaseUrl();
          const response = await fetch(`${baseUrl}/api/tags`);
          if (!response.ok) {
            return { models: [{ id: ollama.getModel(), name: ollama.getModel() }] };
          }
          const data = await response.json() as { models?: { name: string; modified_at?: string }[] };
          const models = (data.models || []).map(m => ({
            id: m.name,
            name: m.name,
            active: m.name === ollama.getModel()
          }));
          return { models, activeModel: ollama.getModel() };
        } catch {
          return { models: [{ id: ollama.getModel(), name: ollama.getModel(), active: true }], activeModel: ollama.getModel() };
        }
      }

      if (provider === "openrouter") {
        const activeModel = (openRouter as unknown as { model?: string }).model || "z-ai/glm-4.5-air:free";
        const models = [
          { id: "z-ai/glm-4.5-air:free", name: "GLM 4.5 Air (Free)" },
          { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (Free)" },
          { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 (Free)" },
          { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)" },
          { id: "qwen/qwen-2.5-72b-instruct:free", name: "Qwen 2.5 72B (Free)" },
          { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
          { id: "openai/gpt-4o", name: "GPT-4o" },
          { id: "google/gemini-2.5-pro-preview-06-05", name: "Gemini 2.5 Pro" },
        ].map(m => ({ ...m, active: m.id === activeModel }));
        return { models, activeModel };
      }

      if (provider === "claude") {
        const activeModel = claudeCliProvider.getModel();
        const models = [
          { id: "haiku", name: "Claude Haiku (Fast)" },
          { id: "sonnet", name: "Claude Sonnet (Balanced)" },
          { id: "opus", name: "Claude Opus (Most Capable)" },
        ].map(m => ({ ...m, active: m.id === activeModel }));
        return { models, activeModel };
      }

      if (provider === "codex") {
        const activeModel = codexCliProvider.getModel();
        const models = [
          { id: "codex-default", name: "Codex (Default)", active: false },
          { id: "codex-mini-latest", name: "Codex Mini (Latest)", active: false },
          { id: "o4-mini", name: "o4-mini", active: false },
        ].map(m => ({ ...m, active: m.id === activeModel }));
        return { models, activeModel };
      }

      if (provider === "local") {
        return { models: [{ id: "browser-relay", name: "Browser Relay (configure in Settings)", active: true }], activeModel: "browser-relay" };
      }

      return reply.code(400).send({ error: "Unknown provider" });
    }
  );

  // Health check for LLM providers
  app.get(
    "/api/chat/health",
    { preHandler: authMiddleware },
    async () => {
      const results: Record<string, { status: string; latency?: number; model?: string; error?: string }> = {};

      // Check Ollama
      try {
        const start = Date.now();
        const res = await fetch(`${ollama.getBaseUrl()}/`, { signal: AbortSignal.timeout(5000) });
        const text = await res.text();
        results.ollama = {
          status: res.ok ? "up" : "down",
          latency: Date.now() - start,
          model: ollama.getModel(),
          ...(res.ok ? {} : { error: `HTTP ${res.status}` })
        };
      } catch (e) {
        results.ollama = { status: "down", model: ollama.getModel(), error: e instanceof Error ? e.message : "Connection failed" };
      }

      // Check OpenRouter
      try {
        const start = Date.now();
        const res = await fetch("https://openrouter.ai/api/v1/models?supported_parameters=temperature&per_page=1", {
          headers: { Authorization: `Bearer ${(openRouter as unknown as { apiKey: string }).apiKey}` },
          signal: AbortSignal.timeout(8000)
        });
        results.openrouter = {
          status: res.ok ? "up" : "down",
          latency: Date.now() - start,
          model: (openRouter as unknown as { model: string }).model,
          ...(res.ok ? {} : { error: `HTTP ${res.status}` })
        };
      } catch (e) {
        results.openrouter = { status: "down", model: (openRouter as unknown as { model: string }).model, error: e instanceof Error ? e.message : "Connection failed" };
      }

      // Check Claude CLI
      results.claude = { status: "up", model: claudeCliProvider.getModel(), error: undefined };

      // Check Codex CLI
      results.codex = { status: "up", model: "default" };

      return { providers: results };
    }
  );

  // Set active model for a provider
  app.post<{ Body: { provider: string; model: string } }>(
    "/api/chat/provider-model",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }

      const { provider, model } = request.body || {};
      if (!provider || !model) {
        return reply.code(400).send({ error: "provider and model are required" });
      }

      if (provider === "ollama") {
        ollama.setModel(model);
        chatSettingsService.set("ollama_active_model", model);
        return { ok: true, model };
      }

      if (provider === "claude") {
        claudeCliProvider.setModel(model);
        return { ok: true, model };
      }

      if (provider === "codex") {
        codexCliProvider.setModel(model);
        return { ok: true, model };
      }

      return reply.code(400).send({ error: "Model switching only supported for Ollama, Claude, and Codex" });
    }
  );

  // List directories under /home/agjrom/websites/ for directory picker
  app.get<{ Querystring: { dir?: string } }>(
    "/api/chat/directories",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const WEBSITES_ROOT = "/home/agjrom/websites";
      const requestedDir = request.query.dir || WEBSITES_ROOT;
      const resolved = path.resolve(requestedDir);

      if (!resolved.startsWith(WEBSITES_ROOT)) {
        return reply.code(400).send({ error: "Directory must be within /home/agjrom/websites/" });
      }

      try {
        const { readdirSync, statSync } = await import("node:fs");
        const entries = readdirSync(resolved, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith("."))
          .map(e => ({
            name: e.name,
            path: path.join(resolved, e.name)
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          current: resolved,
          parent: resolved === WEBSITES_ROOT ? null : path.dirname(resolved),
          root: WEBSITES_ROOT,
          directories: dirs
        };
      } catch {
        return { current: WEBSITES_ROOT, parent: null, root: WEBSITES_ROOT, directories: [] };
      }
    }
  );

  // Set/get cwd for a conversation
  app.post<{ Body: { conversation_id: number; cwd: string } }>(
    "/api/chat/cwd",
    { preHandler: authMiddleware },
    async (request, reply) => {
      if (request.sessionUser?.role !== "owner") {
        return reply.code(403).send({ error: "Owner role required" });
      }
      const { conversation_id, cwd } = request.body || {};
      if (!conversation_id || !cwd) return reply.code(400).send({ error: "conversation_id and cwd required" });

      const WEBSITES_ROOT = "/home/agjrom/websites";
      const resolved = path.resolve(cwd);
      if (!resolved.startsWith(WEBSITES_ROOT)) {
        return reply.code(400).send({ error: "Directory must be within /home/agjrom/websites/" });
      }

      conversationService.setCwd(conversation_id, resolved);
      return { ok: true, cwd: resolved };
    }
  );
}
