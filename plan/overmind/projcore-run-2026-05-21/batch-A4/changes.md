# Batch A4 Changes

## User Report

Next batch A4 (IMPLEMENTER; Claude /projcore supervises). Read plan/overmind/projcore-run-2026-05-21/context-handoff.md then plan/overmind/projcore-run-2026-05-21/prompts/batch-A4.md and follow EXACTLY. A4 = Telegram commands + START the watcher loop in index.ts. NO nudging/sendCommand, NO LLM, NO UI panel.

## Root Cause

A3 added the detection-only Overmind watcher class, but nothing in startup instantiated or started it, so registered workflows were not classified by the 45s loop. Telegram also had no Overmind command handlers, so the owner could not inspect workflow state or pause/resume/drop records from the bot.

## Files Changed

- `src/index.ts`: imports `OvermindWatcher`, constructs it with the existing `OvermindService` and `TmuxService`, starts it after the API server is ready, and logs the 45s startup line.
- `src/bot/assistant-core.ts`: adds `setOvermindService()` and implements `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, and `/om_drop` as pure OvermindService reads/mutations.
- `src/bot/telegram-bot.ts`: adds the five Overmind commands to Telegram `setMyCommands`.
- `tests/overmind-commands.test.ts`: covers status formatting, task glyph formatting, id validation, pause/resume/drop mutation, and empty workflow output.

## Scope Check

- Nudging/sendCommand: not changed.
- LLM behavior: not changed.
- UI panel: not changed.
- HTTP endpoints: not changed.
- Watcher internals: not changed; A4 only instantiates and starts the existing safe loop.

## Autonomous Decisions

None.
