# Batch O5 Changes

## User Report

Next batch O5 (IMPLEMENTER; /projcore from AGJ-51). O5 = make Telegram bot startup/polling NON-FATAL so a Telegram network blip never crashes the app. API + dashboard + overmind watcher must stay up if Telegram is down. Mandatory PROPOSED handshake, then APPROVED-PLAN implementation on `feat/overmind`.

## Root Cause / Mechanism

The app already started the API server and Overmind watcher before Telegram, but it then awaited `telegramAssistant.start()`. A Telegram request failure from `setMyCommands`, menu setup, or `startPolling()` could reject into `main().catch()`, which logged `Fatal startup error` and exited the whole process. That made the local dashboard/API/Overmind depend on Telegram reachability.

## Files Changed

- `src/startup/telegram-resilience.ts`
  - Added `startTelegramNonFatal()` so Telegram startup failures log and return without throwing into fatal startup handling.
  - Added `installTelegramProcessGuards()` with scoped handling for Telegram/request-library network errors.
  - Added `isTelegramNetworkError()` classifier using Telegram/request markers plus network codes/messages.
  - Unknown uncaught exceptions remain fatal.

- `src/index.ts`
  - Installs Telegram process guards at startup.
  - Keeps API server and Overmind watcher startup independent.
  - Replaces direct `await telegramAssistant.start()` with `startTelegramNonFatal()`.

- `src/bot/telegram-bot.ts`
  - Wraps `setMyCommands` and `setChatMenuButton` so failures log and continue.
  - Registers `polling_error` handler to log non-fatally.
  - Wraps `startPolling()` to log, schedule background retry, and surface degraded startup to the non-fatal wrapper.
  - Prevents Telegram send/answer failures inside event handlers from escaping as unhandled rejections.

- `tests/telegram-resilience.test.ts`
  - Covers Telegram network error classification.
  - Covers mocked Telegram startup failure being logged and continued.

## Scope Guard

No OVM feature behavior, O3 web tab, or O4 Telegram chat command work was changed.

Autonomous decisions: none.
