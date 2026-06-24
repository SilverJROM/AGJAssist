# AGJAssist Helm Telegram Passwordless Login Changes

Date: 2026-06-24
Status: DONE

## User Report

APPROVED-PLAN. Implement the approved AGJAssist side of Helm passwordless Telegram login, with the `PLAN-VERDICT.md` deltas:

- Put new tests flat in `tests/`.
- Run `npm test` and `npm run build`.
- Make `sendHelmChallenge` surface real Telegram send failures so the route returns `{ok:false,error:"telegram_send_failed"}`.
- Do not send real Telegram messages during the build.
- Keep the existing `weblogin:` callback path intact.

## Root Cause / Mechanism

AGJAssist did not yet expose a loopback endpoint for Helm to start a Telegram number-match challenge, did not have a shared challenge store for the Fastify route and bot callback handler, and the Telegram callback handler returned early for non-`weblogin:` callback data. The implementation adds the shared in-memory TTL store, route-to-bot bridge, `helmpwl:` callback branch before the existing `weblogin:` branch, and best-effort verdict POST back to Helm.

## Files Touched

- `src/bot/helm-login-store.ts`
  - Added singleton challenge store with default 2-minute TTL, sweep-on-access, duplicate rejection, `get`, one-shot `consume`, and test `clear`.
- `src/bot/helm-login-verdict.ts`
  - Added pure verdict helper returning `"pass"` or `"fail"` from selected number vs display number.
- `src/api/routes/tg-login-routes.ts`
  - Added loopback-only `POST /api/tg/login-challenge`.
  - Validates owner chat ID, challenge ID, two-digit display/buttons, loopback HTTP callback URL, and Telegram availability.
  - Stores challenge, sends through `TelegramAssistant`, returns `502 {ok:false,error:"telegram_send_failed"}` if Telegram send fails.
- `src/api/server.ts`
  - Added optional `telegramAssistant` to `ApiServices`.
  - Registered the Telegram login route group.
- `src/index.ts`
  - Passed the existing `telegramAssistant` instance into `createApiServer`.
- `src/bot/telegram-bot.ts`
  - Added public `sendHelmChallenge(...)` using direct `this.bot.sendMessage(...)` so send failures propagate.
  - Added `helmpwl:` callback handling before the existing `weblogin:` branch.
  - Added message edit and verdict webhook POST helpers with non-crashing error handling.
- `tests/helm-login-store.spec.ts`
  - Added flat Vitest coverage for TTL, expired cleanup, one-shot consume, and duplicate rejection.
- `tests/helm-login-verdict.spec.ts`
  - Added flat Vitest coverage for pass/fail verdict decisions and expired challenge behavior.
- `tests/tg-login-routes.test.ts`
  - Added flat Fastify injection tests for loopback rejection, bad chat rejection, malformed payloads, accepted challenge, and Telegram send failure.
- `tests/telegram-commands.test.ts`
  - Added regression coverage proving the existing `weblogin:` callback path still calls `/weblogin <hours>`.

## Verification

`npm test`

```text
Test Files  55 passed (55)
Tests       650 passed | 1 skipped (651)
Exit code   0
```

`npm run build`

```text
tsc -p tsconfig.json && cp -r src/web dist/
Exit code 0
```

No live Telegram messages were sent. Route and bot-facing behavior were exercised through mocks/Fastify injection only.
