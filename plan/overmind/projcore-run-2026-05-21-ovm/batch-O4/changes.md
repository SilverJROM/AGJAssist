# Batch O4 Changes

User Report verbatim:
Final batch O4 (IMPLEMENTER; /projcore from AGJ-51). Read plan/overmind/projcore-run-2026-05-21-ovm/prompts/batch-O4.md and follow EXACTLY. O4 = Telegram /ovm_start (enter OVM chat mode: reuse/open OVM via O2 manager, route plain messages to the OVM session + relay replies) + /ovm_end (exit mode, session persists) + setMyCommands menu update. MANDATORY handshake: STATUS: PROPOSED first, WAIT for APPROVED-PLAN. feat/overmind. Callback FIRST. Give me your PROPOSED plan now.

Root Cause mechanism:
Telegram only had workflow status commands. There was no per-user OVM chat-mode flag in `AssistantCore`, no command handler for `/ovm_start` or `/ovm_end`, no core wiring for the O2 `OvmSessionService`, and no plain-message relay path from Telegram to the `OVM` tmux session.

Files changed:
- `src/bot/assistant-core.ts`: added per-user `ovmChatMode`, `setOvmSessionService`, `/ovm_start`, `/ovm_end`, and bounded best-effort relay through `tmuxService.sendCommand("OVM", text, true, true)`. Relay captures before/after pane output, waits for stable output up to 12 seconds, strips terminal chrome, and returns fallback text when OVM is still working.
- `src/bot/telegram-bot.ts`: passes Telegram `from.id` into `handleCommand` so slash commands can mutate per-user state, and adds `/ovm_start` plus `/ovm_end` to `setMyCommands` while preserving existing Overmind commands.
- `src/index.ts`: wires the existing O2 `ovmSessionService` into `AssistantCore`.
- `tests/overmind-commands.test.ts`: added focused coverage for `/ovm_start`, plain-message OVM routing/reply relay, bounded fallback, and `/ovm_end` preserving the session.
- `tests/telegram-commands.test.ts`: added command-menu coverage for new OVM commands plus existing Overmind commands.

Autonomous decisions: none.

Caveats:
- Relay extraction is intentionally best-effort; long-running OVM turns return `OVM is taking a while / still working.` instead of waiting indefinitely.
