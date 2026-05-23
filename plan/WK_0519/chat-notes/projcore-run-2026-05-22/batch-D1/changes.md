# Batch D1 — changes.md

## User Report (verbatim)

> "Telegram has NO non-OVM conversational chat. The plain-message LLM fallback and the /op, /om, /llm, /ommodel, /claude, /sonnet, /opus, /haiku, /codex chat prefixes are removed. Only /ovm_start / /ovm_end provide conversational chat. All overmind/tmux/task/utility slash commands remain. setMyCommands menu reflects the removal."

## Root Cause / Feature Statement

`AssistantCore.handleText()` routed plain text through multiple LLM paths (Ollama direct, OpenRouter tool-agent, Ollama tool-agent, and CLI providers via conversation-management wrappers), and `handleCommand()` exposed `/llm` (routing info) and `/ommodel` (Ollama model switcher) as slash commands. `setMyCommands` advertised both. North-star NS-1/NS-2 requires all Telegram LLM chat to be OVM-only; non-OVM paths must be removed entirely.

## Per-File Changes

### `src/bot/assistant-core.ts`

**WHAT**: Removed `OllamaProvider`, `ToolAgent`, `AgentCliRunner` imports. Removed `ALLOWED_OM_MODELS` constant. Removed `openRouterAgent`, `ollamaToolAgent`, `ollamaProvider`, `agentCliRunner` from constructor params. Removed `/llm` and `/ommodel`/`/om_model` case handlers. Removed `/help` text lines for the removed commands and for the old chat prefix/new/cont sections. In `handleText()`: removed `timeoutMs` computation, removed all chat prefix blocks (`new/cont`, `claude`, `opus`, `sonnet`, `haiku`, `codex`, `op`, `om`) and the `ollamaProvider.chat()` default fallback; replaced with a one-line hint. Removed `handleConversationChat()` and `statelessCliChat()` private methods (only ever called from the removed prefix handlers).

**WHY**: Eliminates all Telegram non-OVM LLM paths per NS-1/NS-2. `ClaudeCliProvider`, `CodexCliProvider`, `ConversationService`, `ChatSettingsService` imports/fields remain because `setChatServices()` is kept (API server wires these; later batches D3/D4 will decide what happens to them).

### `src/bot/telegram-bot.ts`

**WHAT**: Removed `{ command: "llm", ... }` and `{ command: "ommodel", ... }` entries from `setMyCommands` array.

**WHY**: Bot command menu must no longer advertise removed commands per acceptance criterion 4.

### `src/index.ts`

**WHAT**: Changed `new AssistantCore(config, openRouterAgent, ollamaToolAgent, ollama, tmuxService, agentCliRunner)` to `new AssistantCore(config, tmuxService)`.

**WHY**: `AssistantCore` constructor no longer accepts those params. `ollama`, `openRouter`, `openRouterAgent`, `ollamaToolAgent`, `agentCliRunner` remain created in `index.ts` — they are still wired to the API server (`createApiServer` call) for `/api/chat/*` routes used by the web dashboard.

## Commits

- `56fd287` `[D1] remove Telegram non-OVM conversational chat (keep OVM + slash cmds)`

## Verification

### Build

```
$ npx tsc
(no output — clean)
```

### Removed prefixes/commands — gone from assistant-core.ts

```
$ grep -n "ollamaProvider\|openRouterAgent\|ollamaToolAgent\|ALLOWED_OM_MODELS\|/ommodel\|case.*\/llm\|handleConversationChat\|statelessCliChat" src/bot/assistant-core.ts
(no output)
```

### Removed commands — gone from telegram-bot.ts setMyCommands

```
$ grep -n "llm\|ommodel" src/bot/telegram-bot.ts
(no output)
```

### OVM/overmind commands KEPT in assistant-core.ts

```
$ grep -n "ovm_start\|ovm_end\|overmind\|om_pause\|om_resume\|om_drop\|ovmChatMode\|relayOvmMessage" src/bot/assistant-core.ts
(present on lines 49, 94, 148-154, 216, 219, 222, 225, 228, 231, 234, 377, 382, 403, 506-507, 557)
```

### OVM commands KEPT in telegram-bot.ts setMyCommands

```
$ grep -n "ovm_start\|ovm_end\|overmind\|om_pause" src/bot/telegram-bot.ts
51: { command: "overmind", ... }
53: { command: "om_pause", ... }
56: { command: "ovm_start", ... }
57: { command: "ovm_end", ... }
```

### Plain-text hint in place

```
$ grep -n "ovm_start to chat" src/bot/assistant-core.ts
557: return "Use /ovm_start to chat with OVM, or a slash command. /help for the list.";
```

## Caveats

- `agentCliRunner` is still instantiated in `index.ts` (line 83) but no longer passed to `AssistantCore`. It is an orphan until a later batch cleans it up. Build is clean (no `noUnusedLocals`).
- `ConversationService`, `ChatSettingsService`, `ClaudeCliProvider`, `CodexCliProvider` remain wired to `AssistantCore` via `setChatServices()` — these are kept because D3/D4 batches will decide their fate in the Telegram context. They are still used by the API server path.
- The `cd` handler in `handleText()` retains a comment "new conversation will start on next message" — minor inaccuracy post-removal; out of D1 scope.

## Autonomous Decisions

None.
