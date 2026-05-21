# Batch O4 Independent Validation

Requirement OU4:
- `/ovm_start` enters OVM chat mode for the Telegram user and reuses/opens the OVM session via O2 manager.
- Plain messages while active route to the `OVM` tmux session and relay replies to Telegram.
- `/ovm_end` exits chat mode without killing the OVM session.
- Telegram command menu includes new OVM commands and existing Overmind commands.
- `npx tsc` clean.

Validation:
- PASS: `AssistantCore` stores `ovmChatMode` in per-user state and initializes it false (`src/bot/assistant-core.ts:50`, `src/bot/assistant-core.ts:111`).
- PASS: `/ovm_start` calls `ovmSessionService.open()`, sets `ovmChatMode = true`, and returns the required confirmation (`src/bot/assistant-core.ts:281`, `src/bot/assistant-core.ts:423`).
- PASS: `/ovm_end` clears the flag only and does not close/terminate OVM (`src/bot/assistant-core.ts:284`, `src/bot/assistant-core.ts:430`).
- PASS: Plain `handleText()` checks OVM mode before normal chat routing and relays to `tmuxService.sendCommand("OVM", input, true, true)` (`src/bot/assistant-core.ts:452`, `src/bot/assistant-core.ts:550`).
- PASS: Relay waits for changed/stable pane output and returns bounded fallback when no reply appears (`src/bot/assistant-core.ts:467`, `src/bot/assistant-core.ts:495`).
- PASS: Telegram message handling passes `from.id` to command handling so mode is per user (`src/bot/telegram-bot.ts:127`).
- PASS: `setMyCommands` includes `/ovm_start`, `/ovm_end`, and existing Overmind commands (`src/bot/telegram-bot.ts:53`).
- PASS: Application wiring injects O2 `ovmSessionService` into `AssistantCore` (`src/index.ts:138`).

Evidence:
- PASS: `npx vitest run tests/overmind-commands.test.ts tests/telegram-commands.test.ts`.
- PASS: `npx tsc`.
- PASS: `npm run build`.

Residual risk:
- OVM pane parsing remains best-effort by design because Claude TUI output can vary. The timeout/fallback path is covered and prevents indefinite Telegram waits.
