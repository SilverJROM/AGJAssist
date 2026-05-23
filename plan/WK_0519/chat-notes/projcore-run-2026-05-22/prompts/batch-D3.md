Batch-D3: Remove the dead chat backend ROUTES

Branch: feat/chat-decommission-notes-ios · Req: R3 · NS-1
Backend. The UI no longer calls these (D2b made OVM the only chat). Remove the chat/conversation/local-llm/chat-settings HTTP routes + their registration. Providers + services come out in D4 — this batch is the routes layer only. Build + suite stay green.

User report (verbatim): "decommission the chat as well those are from old design that i dont need anymore."

Read first: src/api/server.ts (the registration calls + the ApiServices type) and the route files: chat-routes.ts, conversation-routes.ts, local-llm-routes.ts, chat-settings-routes.ts.

Acceptance criteria (R3):
1. Remove the route files + their registration in server.ts: chat-routes.ts (/api/chat/*), conversation-routes.ts (/api/conversations/*), local-llm-routes.ts (/api/local-llm/*), chat-settings-routes.ts (/api/chat-settings/*). Delete the files and remove their imports + register*Routes(...) calls from server.ts.
2. KEEP: the overmind routes (incl. /api/overmind/ovm/send, /reply, open/restart/close/status), notes routes, and all other non-chat routes.
3. server.ts ApiServices: you MAY leave the ollama/openrouter/local-relay provider + agent fields in the type/params for now (D4 removes them) — but if leaving them causes "declared but never used" TS errors, either keep them passed-through harmlessly or remove the now-unused ones; whatever keeps `npx tsc` clean. Do NOT remove the providers themselves or conversation-service/chat-settings-service yet (D4) unless leaving a route file deletion forces it — if a service becomes truly orphaned and removing its route makes it unused, that's fine to leave for D4.
4. Cosmetic: rename the web header nav link text "Conversations" → "Chat" in src/web/public/app.js (~line 435). (The route stays /conversations = OVM.)
5. Build green (`npx tsc` + `npm run build`); `npx vitest run` green except the known Ollama conversation-memory failure. Remove/adjust any tests that hit the removed routes (e.g. a chat-routes or conversation-routes test file).
6. App must boot (no missing-route registration errors).

Scope/DON'T:
- Backend routes layer + the one nav-label cosmetic. Do NOT remove the LLM providers, ToolAgent, conversation-service, chat-settings-service, or config.llm keys (that's D4). Do NOT touch Notes, overmind, the OVM chat.
- Do NOT drop DB tables (conversations/chat_settings stay dormant).

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-D3/changes.md (Codex template + Verification: tsc/build PASS, vitest counts, list removed route files + confirm /api/overmind/ovm/* + notes routes still registered + app boots).
- decisions/ entry if non-trivial, else "none."

Commit `[D3] remove chat/conversation/local-llm/chat-settings routes + server.ts registration; rename header link to Chat`. End with STATUS marker.
