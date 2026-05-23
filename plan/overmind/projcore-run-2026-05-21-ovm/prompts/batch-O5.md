Batch-O5: Telegram startup/polling resilience (app must not crash if Telegram is unreachable)

Batch ID: O5
Requirements: og-requirements-ovm.md (OU5)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

Context: a brief Telegram network blip crashed the WHOLE app at startup — error: "Fatal startup error: RequestError: AggregateError" originating in node-telegram-bot-api's request lib (request-promise-core / @cypress/request) during bot init. This took down the local API + dashboard + overmind watcher. The local server must NOT depend on Telegram reachability.

Requirement (OU5): "the local server (API + dashboard + overmind watcher) must start and stay up regardless of Telegram reachability. Wrap bot startup (start/polling/setMyCommands) so failures LOG and CONTINUE with background retry, never crash/exit. Process-level guards so the bot's network errors don't kill the process. Dashboard/overmind work with Telegram fully down."

Expected (acceptance):
1. Find where the bot is started at boot (src/index.ts and src/bot/telegram-bot.ts — `bot.start()`, polling setup, `setMyCommands`). Wrap those awaits in try/catch: on failure, console.error a clear line + CONTINUE (do NOT rethrow, do NOT process.exit). The API server + overmind watcher start independently of the bot outcome.
2. Telegram polling errors (the bot emits 'polling_error') must be handled so they never become unhandled/fatal — log + let node-telegram-bot-api retry (it polls on an interval). If setMyCommands fails, log + skip (retry opportunistically or just skip — menu is non-critical).
3. Add a top-level guard if not present: process.on('unhandledRejection', ...) + process.on('uncaughtException', ...) that LOG (and for uncaughtException, only exit on truly unknown fatal errors — but a Telegram/network RequestError must be swallowed/logged, not crash). Be careful: don't blanket-swallow everything in a way that hides real bugs — scope to logging + keep the process alive for network-class errors.
4. Verify: the order of startup so API + watcher come up BEFORE/independent of the bot, and a bot failure doesn't prevent them.
5. npx tsc clean.

Likely files: src/index.ts (startup sequence + guards), src/bot/telegram-bot.ts (start/polling/setMyCommands error handling).
Scope: startup/polling resilience ONLY. Don't change OVM/overmind features. Surgical.
Tests: hard to unit-test network failure; add what's reasonable (e.g. that a thrown bot.start() is caught and server still set up — mock the bot to throw, assert createApiServer/watcher still ran + no process exit). At minimum tsc + a code-review-level assertion. npm run build.

Plan handshake (MANDATORY): read brief + index.ts (startup) + telegram-bot.ts (start/polling/setMyCommands). Reply STATUS: PROPOSED with exactly where you wrap + the guard approach + how API/watcher stay independent. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tsc + npm run build + any test). Artifacts batch-O5/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: I will simulate by checking the app stays up; you ensure the wrap is real.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O5 <STATE> <note>, THEN STATUS: <verb> -- reason.
