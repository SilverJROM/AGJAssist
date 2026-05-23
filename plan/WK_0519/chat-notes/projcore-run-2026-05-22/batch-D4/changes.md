# Batch-D4 Changes — Chat Decommission Capstone

## Summary

Remove now-orphaned LLM providers (Ollama/OpenRouter/LocalRelay), ToolAgent/ToolRegistry wiring,
ConversationService, ChatSettingsService, config.llm, and the failing Ollama test. Chat routes
removed in D3; TG chat removed in D1. End state: tsc clean, build clean, vitest fully green.

---

## Files Removed

### LLM Providers
- `src/llm/ollama-provider.ts`
- `src/llm/openrouter-provider.ts`
- `src/llm/local-relay-provider.ts`

### Orchestration
- `src/orchestration/tool-agent.ts` — only used by Ollama/OpenRouter chat agents (orphaned)

### Services
- `src/services/conversation-service.ts` — routes removed in D3; no live callers
- `src/services/chat-settings-service.ts` — routes removed in D3; no live callers

### Tests Removed
- `tests/unit/conversation-memory.spec.ts` — the known failing Ollama test (R4.6)
- `tests/unit/conversation-service.spec.ts` — exercised removed ConversationService
- `tests/e2e/orchestration.spec.ts` — exercised ToolAgent (removed)
- `tests/e2e/orchestration.spec.js` — compiled artifact of removed .ts (never picked up by vitest config)

---

## Files Modified

### src/config/config.ts
- Removed `llm` block from `AppConfig` interface (7 keys: ollamaBaseUrl, ollamaModel,
  ollamaTimeoutMs, openrouterApiKey, openrouterBaseUrl, openrouterModel, openrouterTimeoutMs)
- Removed `llm` block from `loadConfig()` return value
- `OPENROUTER_API_KEY` `required()` call removed (no longer throws on missing env var)

### src/bot/assistant-core.ts
- Removed imports: `ClaudeCliProvider`, `CodexCliProvider`, `ConversationService`, `ChatSettingsService`
- Removed private fields: `conversationService`, `chatSettingsService`, `claudeCliProvider`, `codexCliProvider`
- Removed `setChatServices()` method
- Removed dead `UserState` fields: `activeConversationId`, `activeProvider`
- Simplified `cd` handler: removed dead conversation reset block + "(new conversation will start...)" message

### src/api/server.ts
- Removed imports: `ConversationService`, `ChatSettingsService`, `OllamaProvider`, `OpenRouterProvider`,
  `ToolAgent`, `ToolRegistry`, `ClaudeCliProvider`, `CodexCliProvider`
- Removed `ApiServices` fields: `conversationService`, `chatSettingsService`, `ollama`, `openRouter`,
  `ollamaAgent`, `openRouterAgent`, `tools`, `maxToolIterations`, `claudeCliProvider`, `codexCliProvider`

### src/index.ts
- Removed imports: `OllamaProvider`, `OpenRouterProvider`, `ToolRegistry`, `ToolAgent`,
  `ConversationService`, `ChatSettingsService`, `ClaudeCliProvider`, `CodexCliProvider`,
  `DefaultAgentCliRunner` (was instantiated but never used)
- Removed: OllamaProvider + OpenRouterProvider instantiation, ToolRegistry + ToolAgent construction
- Removed: `conversationService`, `chatSettingsService` instantiation
- Removed: chatSettingsService soul_md/context_md seeding block
- Removed: `core.setChatServices(...)` call
- Removed dead createApiServer args: `conversationService`, `chatSettingsService`, `ollama`,
  `openRouter`, `ollamaAgent`, `openRouterAgent`, `tools`, `maxToolIterations`,
  `claudeCliProvider`, `codexCliProvider`

### Test configs updated (llm: block removed)
- `tests/overmind-nudge.test.ts` — removed `llm:` block from `testConfig()`
- `tests/overmind-commands.test.ts` — removed `llm:` block from `testConfig()`
- `tests/overmind-routes.test.ts` — removed `llm:` block from `testConfig()`
- `tests/unit/personal-tasks-reminders.spec.ts` — removed `ChatSettingsService` import,
  `chatSettingsService` variable declaration + initialization, and the entire
  `describe("ChatSettingsService", ...)` block (6 tests)

---

## Decisions

None non-trivial. `ClaudeCliProvider` and `CodexCliProvider` kept — `overmind-brain.ts` uses
`ClaudeCliProvider` directly. `ToolRegistry` removed from wiring (chat-only); the file
`src/tools/tool-registry.ts` itself is still present (not referenced, but safe to leave for
potential future use — out of D4 scope). DB tables `conversations`/`chat_settings` stay dormant
per spec (no DROP).

---

## Verification

```
npx tsc --noEmit   → 0 errors (clean)
npm run build      → clean (tsc + cp web assets)
npx vitest run     → Test Files: 26 passed (26) | Tests: 290 passed (290) | 0 failures
```

OVM chat (/api/overmind/ovm/*, ovm-session), Notes, overmind watcher/brain, OVM launch — all intact,
all tests green. ClaudeCliProvider kept (overmind-brain.ts uses it directly on its own path).
