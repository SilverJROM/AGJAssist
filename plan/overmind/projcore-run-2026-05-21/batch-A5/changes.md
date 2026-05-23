# Batch A5 Changes

## User Report

APPROVED-PLAN for A5 with ONE adjustment: the DONE push must NOT rely on the watcher observing a completed row (the watcher skips completed/paused rows). Completion is authoritative via POST /api/overmind/complete. So fire the DONE notify from the /complete route handler (after setStatus('completed')), threading the same notify fn into registerOvermindRoutes from index.ts. That guarantees exactly-once and doesn't depend on the watcher. Everything else as proposed (Tier1/2 ladder coordinator-only, nudge_count backoff, reset-on-working, Tier-3 hook, best-effort try/catch notify). Implement on feat/overmind, commit, gate (npx tsc clean + npx vitest run tests/overmind-nudge.test.ts green; keep full suite's overmind tests green). Artifacts batch-A5/changes.md + test-report.md + independent-validation.md. Append callback FIRST ([projcore callback] A5 DONE <note>), THEN reply STATUS: DONE -- reason. Coordinator-only nudges — assert in tests.

## Root Cause / Mechanism

A4 classified workflow state but did not act on `stuck`, so persisted `nudge_count` and `tier` were unused. Completion notification also could not be implemented reliably in the watcher because the watcher intentionally filters terminal statuses (`paused`, `completed`, `failed`) before ticking.

## Files Changed

- `src/services/overmind-watcher.ts`
  - Added `CANNED_NUDGE`, `MAX_CANNED_NUDGES`, and optional `OvermindNotify`.
  - Added Tier 1/2 stuck handling that sends only to `workflow.coordinator_session` with `sendCommand(..., true, true)`.
  - Stops re-nudging after `nudge_count >= 2` and leaves the A6 Tier-3 hook.
  - Resets `nudge_count` and `tier` to 0 when classifier reports `working`.
  - Added best-effort DONE/BLOCKED notify helpers for later escalation wiring.

- `src/api/routes/overmind-routes.ts`
  - Accepts optional `notify`.
  - Sends the DONE notification from `POST /api/overmind/complete` after `setStatus("completed")`.
  - Suppresses duplicate DONE notifications if `/complete` is called again on an already completed workflow.

- `src/api/server.ts`
  - Threads optional `overmindNotify` into overmind route registration.

- `src/index.ts`
  - Creates a shared `overmindNotify` function using `TelegramAssistant.sendMessage(config.telegram.authorizedUserId, text)`.
  - Injects the same notifier into the watcher and API routes.

- `src/bot/telegram-bot.ts`
  - Starts polling in `start()` instead of the constructor.
  - Exposes `sendMessage()` for Overmind notifications.

- `tests/overmind-nudge.test.ts`
  - Covers Tier 1, Tier 2, Tier 2 exhausted, coordinator-only send target, reset-on-working, and `/complete` DONE exactly-once.

## Autonomous Decisions

None.
