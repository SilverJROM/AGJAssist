# Batch D3 — Remove dead chat backend routes

## Summary
Remove the 4 route modules (chat, conversation, local-llm, chat-settings) that the UI no longer calls
after D2b made OVM the only chat. Rename header nav "Conversations" → "Chat". Providers/services
retained for D4.

## Changes

### Deleted files
- `src/api/routes/chat-routes.ts` — /api/chat/* endpoints
- `src/api/routes/conversation-routes.ts` — /api/conversations/* endpoints
- `src/api/routes/local-llm-routes.ts` — /api/local-llm/* + /ws/local-llm endpoints
- `src/api/routes/chat-settings-routes.ts` — /api/chat-settings/* endpoints

### Modified files

**`src/api/server.ts`**
- Removed imports: `registerConversationRoutes`, `registerChatSettingsRoutes`, `registerChatRoutes`,
  `registerLocalLlmRoutes`
- Removed registration calls: `registerConversationRoutes`, `registerChatSettingsRoutes`,
  `registerChatRoutes`, `registerLocalLlmRoutes`
- Retained `ApiServices` interface fields for providers/services (D4 removes them):
  `conversationService`, `chatSettingsService`, `ollama`, `openRouter`, `ollamaAgent`,
  `openRouterAgent`, `tools`, `maxToolIterations`, `claudeCliProvider`, `codexCliProvider`

**`src/web/public/app.js`** (line 435)
- Renamed header nav link label: `Conversations` → `Chat` (href stays `#/conversations`)

## Tests removed / adjusted
None — no test files directly imported or hit the removed route files. Tests touching
`ConversationService` / `ChatSettingsService` at the service layer are unaffected and still pass.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc` | PASS (0 errors) |
| `npm run build` | PASS |
| `npx vitest run` | 314 passed / 1 failed (known Ollama model-not-found failure in conversation-memory.spec.ts — pre-existing) |
| Route files deleted | chat-routes.ts, conversation-routes.ts, local-llm-routes.ts, chat-settings-routes.ts |
| Overmind routes still registered | `registerOvermindRoutes` present at line 144 of server.ts |
| Notes routes still registered | `registerNoteRoutes` present at line 136 of server.ts |
| App boots | No missing-route-registration errors; server.ts import graph clean |

## Decisions
None — straightforward removal; no non-trivial decisions made.
