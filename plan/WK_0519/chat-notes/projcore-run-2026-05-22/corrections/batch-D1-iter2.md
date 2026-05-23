# Correction — Batch D1, iter 2

Gate failed: §1.10 gate-4 (targeted tests). Production code in 56fd287 is CORRECT — do NOT touch src/ production files. Only the TEST files need updating to follow the decommission.

## Mechanism (root cause)
`tests/e2e/orchestration.spec.ts` and `tests/overmind-commands.test.ts` still construct AssistantCore with the OLD positional signature `new AssistantCore(config, openRouterAgent, ollamaToolAgent, ollamaProvider, tmuxService, ...)`. The new signature is:
```
constructor(config: AppConfig, tmuxService: TmuxService)
```
with deps wired via setters: `setServices(projectService, noteService, authService, ownerUserId)`, `setChatServices(conversationService, chatSettingsService, claudeCliProvider, codexCliProvider)`, `setOvermindService(...)`, `setOvmSessionService(...)`. Because the old call passes `openRouterAgent` where `tmuxService` now goes, `this.tmuxService.listJobsSummary is not a function` and EVERY test in those files cascade-fails.

## Gaps to fix (ONLY these)
1. **overmind-commands.test.ts** — update AssistantCore construction to the new signature + the setters each test needs (tmux via setServices, OVM via setOvmSessionService/setOvermindService). The OVM-routing tests (plain message → OVM, bounded fallback, /ovm_end) must pass — OVM chat mode is retained.
2. **orchestration.spec.ts** — (a) REMOVE the now-obsolete test cases that exercise DECOMMISSIONED chat behavior: "routes OP prefix to tool-enabled OpenRouter flow", "routes OM prefix to tool-enabled Ollama flow and allows model switching", "allows OP tool flow to send command to tmux". That behavior no longer exists. (b) KEEP and FIX the still-valid tmux tests ("supports manual tmux command path", "supports manual tmux_send command path") under the new constructor + setServices. (c) Remove any now-unused imports/helpers (FakeLlm/ToolAgent/FakeOllamaProvider/FakeToolRegistry) left dangling by the removals.
3. Re-run `npx vitest run`. Expected: ALL green EXCEPT the single known `tests/unit/conversation-memory.spec.ts` Ollama-live failure (that test is removed in a later batch — LEAVE it). Report the final pass/fail counts.

## Don't re-do
- Do NOT modify src/bot/assistant-core.ts, src/bot/telegram-bot.ts, or src/index.ts — the production decommission is correct and validated.
- Commit the test fixes with `[D1] update tests for TG chat removal (new AssistantCore signature; drop obsolete chat-flow tests)`.

End with STATUS marker.
