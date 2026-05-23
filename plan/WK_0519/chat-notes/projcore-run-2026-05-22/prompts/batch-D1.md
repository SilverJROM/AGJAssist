Batch-D1: Remove Telegram non-OVM conversational chat

Batch ID: D1
Branch: feat/chat-decommission-notes-ios (work DIRECTLY on this branch — it is the feature branch, NOT master. projcore owns merge. Do NOT create a sub-branch.)
Requirements assigned: R1
North-star anchors: NS-1 (remove all non-OVM chat), NS-2 (only /ovm_start /ovm_end for chat)

This is ONE atomic vertical slice (§1.4c): tight diff, build stays green.

User report (verbatim from og-requirements R1):
"Telegram has NO non-OVM conversational chat. The plain-message LLM fallback and the /op, /om, /llm, /ommodel, /claude, /sonnet, /opus, /haiku, /codex chat prefixes are removed. Only /ovm_start / /ovm_end provide conversational chat. All overmind/tmux/task/utility slash commands remain. setMyCommands menu reflects the removal."

Observed (current state, from inventory):
- src/bot/assistant-core.ts: constructor injects openRouterAgent, ollamaToolAgent, ollamaProvider (~lines 75-77). Commands `/llm` (~223-232) and `/ommodel` (~247-264) + ALLOWED_OM_MODELS (~19). handleText() (~551-677) routes: `/op ` → openRouterAgent (~653-659), `/om ` → ollamaToolAgent (~661-667), `/claude /sonnet /opus /haiku /codex ` → CLI providers (~623-651), and plain message (no prefix) → ollamaProvider.chat() direct (~670-676). Conversation new/cont keyword handling is part of this old chat path.
- src/bot/telegram-bot.ts: setMyCommands (~53-58) lists chat commands.

Expected (acceptance criteria):
1. All of these Telegram chat affordances are REMOVED: the plain-message LLM fallback; the `/op`, `/om`, `/llm`, `/ommodel`, `/claude`, `/sonnet`, `/opus`, `/haiku`, `/codex` prefixes; the conversation new/cont chat management tied to them; and the unused constructor params for openRouterAgent/ollamaToolAgent/ollamaProvider (and update index.ts to stop passing them to AssistantCore — but keep them created in index.ts for now; the API server still uses them until a later batch).
2. KEPT and working: `/ovm_start` / `/ovm_end` and the OVM chat-mode message routing (when ovmChatMode is on, plain text goes to the OVM session); ALL overmind slash commands (/overmind, /om_tasks, /om_pause, /om_resume, /om_drop), tmux commands, task commands, and any utility commands.
3. Plain text when NOT in OVM chat mode: return a short hint (e.g. "Use /ovm_start to chat with OVM, or a slash command. /help for the list.") — do NOT route to any LLM.
4. setMyCommands no longer lists /llm or /ommodel (or any removed chat command). /ovm_start /ovm_end and overmind/task commands remain.
5. Build green: `npx tsc` clean.

Likely files:
- src/bot/assistant-core.ts
- src/bot/telegram-bot.ts
- src/index.ts (only to stop passing the now-unused chat deps to AssistantCore's constructor)

Scope / DON'T:
- DO NOT remove ClaudeCliProvider — src/services/overmind-brain.ts depends on it (Sonnet brain). It STAYS.
- DO NOT touch the LLM provider source files (ollama-provider.ts, openrouter-provider.ts, local-relay-provider.ts), the /api/chat/* or /api/conversations/* routes, conversation-service, or chat-settings — those are later batches (D3/D4). Leave them; index.ts may keep creating providers for the API server for now.
- DO NOT touch Notes, overmind internals, or the OVM session manager.
- Surgical only. No "while I'm in here."

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-D1/changes.md (Codex template: User Report verbatim + Root Cause/feature statement + per-file WHAT+WHY + Verification: build PASS + grep evidence the prefixes/commands are gone + Caveats)
- decisions/<date>-<slug>.md per §1.15 if any non-trivial autonomous call, else state "Autonomous decisions: none."

Completion protocol:
- Run `npx tsc` and confirm clean. Provide grep evidence (e.g. `grep -n "ollamaProvider\|/ommodel\|'/llm'" src/bot/assistant-core.ts` shows the chat paths gone).
- Commit to feat/chat-decommission-notes-ios with message: `[D1] remove Telegram non-OVM conversational chat (keep OVM + slash cmds)`.
- End your reply with `STATUS: DONE — <summary>` / `STATUS: BLOCKED — ...` / `STATUS: NEEDS CLARIFICATION — ...`.
