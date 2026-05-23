Batch-D4: Remove LLM providers + chat services + config.llm + the failing Ollama test (capstone)

Branch: feat/chat-decommission-notes-ios · Req: R4 · NS-1
Backend cleanup. The chat routes (D3) + UI (D1/D2b) are gone. Remove the now-orphaned providers/services/config and the failing Ollama test. End state: build + FULL suite GREEN (0 failures). Remove references together; GREP first to find every orphan and dangling import.

User report (verbatim): "the ollama ones are not needed any more can you decommission these ... those are from old design that i dont need anymore."

Acceptance criteria (R4):
1. Remove the LLM provider files now that nothing routes to them: src/llm/ollama-provider.ts, src/llm/openrouter-provider.ts, src/llm/local-relay-provider.ts. GREP for their imports first; remove all usages.
2. ToolAgent (src/orchestration/tool-agent.ts) + tool-registry: if orphaned after the providers are gone (grep — they were used only by the chat agents), remove them. If something non-chat still uses them, leave + note it.
3. conversation-service.ts + chat-settings-service.ts: orphaned now (their routes were removed in D3; the TG chat was removed in D1). GREP — if nothing references them (incl. assistant-core's setChatServices and index.ts wiring), remove them and their wiring. assistant-core: remove setChatServices + the conversation/chat-settings/provider fields if they are now unused (KEEP ClaudeCliProvider/CodexCliProvider only if still used by something non-chat; the overmind brain uses ClaudeCliProvider via its OWN path — verify whether assistant-core still needs it; remove from assistant-core if dead).
4. config.llm: remove the ollama*/openrouter* keys from src/config/config.ts AND the AppConfig `llm` type. Update EVERY testConfig()/AppConfig literal in tests that sets `llm: {...}` (there are several — grep `llm:` and `ollamaBaseUrl` across tests) so they still compile. If `llm` becomes empty, remove the field entirely (and from all test configs).
5. index.ts + server.ts: remove the provider/agent instantiation + the now-unused ApiServices fields + any passing of removed services to AssistantCore/the API server. App must boot.
6. Remove the failing Ollama test: tests/unit/conversation-memory.spec.ts (it tests the removed conversation/Ollama path). Remove any other tests that exercise removed providers/services/ToolAgent.
7. DB tables conversations/chat_settings stay DORMANT (no DROP).
8. END STATE: `npx tsc` clean, `npm run build` clean, `npx vitest run` — ALL GREEN (0 failures; the Ollama failure is gone because the test is removed). App boots; OVM chat + notes + overmind all still work.

Scope/DON'T:
- Do NOT touch the OVM chat (ovm-session, the /api/overmind/ovm/* routes), Notes, overmind watcher/brain (except removing dead chat wiring), or the OVM session launch.
- KEEP ClaudeCliProvider + CodexCliProvider IF anything still uses them (grep) — remove only if truly orphaned. The overmind brain (overmind-brain.ts) uses ClaudeCliProvider — that path STAYS.
- Do NOT drop DB tables.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-D4/changes.md (Codex template + Verification: tsc/build PASS, vitest FULL GREEN with counts, list every file removed + every test-config updated, confirm app boots + OVM chat/notes/overmind intact, confirm ClaudeCliProvider kept if still used).
- decisions/ entry if non-trivial (e.g. config.llm removal ripple), else "none."

Commit `[D4] remove ollama/openrouter/local-relay providers + ToolAgent + conversation/chat-settings services + config.llm + Ollama test (chat decommission complete)`. End with STATUS marker.
