# AGJAssist Helm Telegram Passwordless Login Plan

Status: PROPOSED
Date: 2026-06-24
Scope: AGJAssist side only, per `CONTRACT.md` v1.0.

## Decision

Use bridge option A: add the existing `TelegramAssistant` instance to `ApiServices` and expose a public `sendHelmChallenge(...)` method on `TelegramAssistant`.

Why: the route needs to send through the already configured bot instance, while the callback handler also lives in that same class. This avoids duplicating Telegram token handling in an API route and keeps send/edit/answer behavior in the bot boundary.

## File List

New files:

- `src/bot/helm-login-store.ts`
  - Singleton in-memory challenge store shared by the Fastify route and Telegram callback handler.
  - Owns 2-minute TTL, expired sweep-on-access, and one-shot consume semantics.
- `src/api/routes/tg-login-routes.ts`
  - Registers `POST /api/tg/login-challenge`.
  - Applies loopback-only preHandler.
  - Validates request body and owner chat.
  - Stores the challenge, then asks `TelegramAssistant` to send the inline keyboard.
- `src/bot/helm-login-verdict.ts`
  - Small pure helper `decideHelmLoginVerdict(challenge, selected)` returning `"pass" | "fail"` so verdict logic can be tested without real Telegram.
- `tests/unit/helm-login-store.spec.ts`
  - Unit coverage for TTL, expired cleanup, duplicate/one-shot behavior.
- `tests/api/tg-login-routes.test.ts`
  - Route coverage for loopback reject, bad chatId reject, malformed payload reject, and accepted challenge without real Telegram.
- `tests/unit/helm-login-verdict.spec.ts`
  - Unit coverage for verdict decision logic: pass, fail, expired/missing.

Modified files:

- `src/bot/telegram-bot.ts`
  - Import shared store and verdict helper.
  - Add public `sendHelmChallenge(input)` method that sends the prompt and 3-button inline keyboard using `sendMessageSafe`.
  - Extend `bot.on("callback_query")` so `helmpwl:` is handled before the existing early return for `weblogin:`.
  - Keep the current `weblogin:` branch unchanged.
  - Add private `handleHelmPasswordlessCallback(query)` method:
    - Parse `helmpwl:<challengeId>:<selected>`.
    - Reject unauthorized/non-owner callback with toast only.
    - Consume challenge atomically; expired/missing returns toast `"Expired"` and stops.
    - Compare selected number with `displayNumber`.
    - Edit Telegram message to `✅ Signed in to Helm` or `❌ Sign-in denied`.
    - Answer callback toast.
    - POST verdict to stored `callbackUrl` as `{challengeId,result:"pass"|"fail"}`.
    - Catch edit/webhook failures so polling handler does not crash.
- `src/api/server.ts`
  - Add `import type { TelegramAssistant } from "../bot/telegram-bot.js";`
  - Add `telegramAssistant?: TelegramAssistant;` to `ApiServices`.
  - Register `registerTgLoginRoutes(app, config, services.telegramAssistant);`
- `src/index.ts`
  - Pass the existing instance into the API server service bag:
    - `telegramAssistant,`
  - No startup order change is required because `telegramAssistant` is constructed before `createApiServer(...)`.

## Store Interface

Module: `src/bot/helm-login-store.ts`

Types:

```ts
export interface HelmLoginChallenge {
  challengeId: string;
  displayNumber: number;
  callbackUrl: string;
  expiresAt: number;
  consumed: boolean;
}

export interface HelmLoginChallengeInput {
  challengeId: string;
  displayNumber: number;
  callbackUrl: string;
  ttlMs?: number;
}

export type HelmLoginConsumeResult =
  | { ok: true; challenge: HelmLoginChallenge }
  | { ok: false; reason: "missing" | "expired" | "consumed" };
```

Methods:

```ts
put(input: HelmLoginChallengeInput): { ok: true } | { ok: false; reason: "duplicate" };
get(challengeId: string): HelmLoginChallenge | null;
consume(challengeId: string): HelmLoginConsumeResult;
sweep(now?: number): void;
clear(): void; // test-only utility, still safe as exported method on singleton
```

Semantics:

- Default TTL is `120_000` ms.
- `put` sweeps expired entries first and rejects duplicate unexpired challenge IDs.
- `get` sweeps/clears expired entries and returns `null` for expired, missing, or consumed rows.
- `consume` is atomic from the caller perspective: it marks/removes the row before returning the usable challenge so a double tap cannot double-fire the webhook.
- Expired challenges are removed on `get`, `put`, and `consume`.
- Verdict POST is best-effort after consume; webhook failure is logged and does not revive the challenge.

## Route Contract

Endpoint: `POST /api/tg/login-challenge`

Loopback guard:

- Reuse the pure socket-address pattern from `agent-routes.ts`.
- Accept `127.0.0.1`, any `127.*`, `::1`, and `::ffff:127.0.0.1`.
- Non-loopback returns `403 {ok:false,error:"loopback_required"}`.

Required request validation:

- `challengeId` present, non-empty string.
- `chatId === config.telegram.authorizedUserId` and therefore `1000000001` in this environment.
- `displayNumber` is an integer two-digit number.
- `buttons` is an array of exactly 3 integer two-digit numbers.
- `buttons` includes `displayNumber`.
- `callbackUrl` present, valid URL, loopback HTTP URL.
- `prompt` present non-empty string, or default to the contract prompt if omitted.
- Missing `telegramAssistant` in test mode returns `503 {ok:false,error:"telegram_unavailable"}`.
- Store duplicate returns `409 {ok:false,error:"challenge_exists"}`.
- All validation failures return `4xx {ok:false,error:"..."}`.

Accepted behavior:

- Store `{challengeId, displayNumber, callbackUrl}` with 2-minute TTL.
- Call `telegramAssistant.sendHelmChallenge({chatId,prompt,challengeId,buttons})`.
- Send only to the validated owner chat ID.
- Return `200 {ok:true}` if Telegram send was attempted successfully by the method.

## Telegram Callback Handling

Handler ordering:

- In `callback_query`, branch first on `helmpwl:`.
- Then keep the existing `weblogin:` branch exactly as-is.
- Unknown callback data continues to return immediately.

Parsing:

- Split into exactly `["helmpwl", challengeId, selected]`.
- `challengeId` must be non-empty.
- `selected` must parse as an integer.
- Bad format answers callback with `"Expired"` or `"Invalid"` and stops without webhook.

Owner rule:

- Only accept callbacks where `core.isAuthorized(query.from.id)` is true.
- Because the challenge route only sends to owner `chatId`, this preserves the owner-only contract without hard-coding a second owner constant in the handler.

Verdict:

- `consume(challengeId)` missing/expired/consumed: answer toast `"Expired"` and stop.
- `selected === challenge.displayNumber`: result `"pass"`, edit message `✅ Signed in to Helm`.
- Otherwise result `"fail"`, edit message `❌ Sign-in denied`.
- POST `{challengeId,result}` to `challenge.callbackUrl` with native `fetch`.
- Catch/log webhook failure and do not throw out of the handler.

## Wiring Details

`server.ts` changes:

- Add a type import for `TelegramAssistant`.
- Add this field to `ApiServices`:

```ts
telegramAssistant?: TelegramAssistant;
```

- Register the new route group after health/static setup and before return:

```ts
registerTgLoginRoutes(app, config, services.telegramAssistant);
```

`index.ts` change at the `createApiServer(config, { ... })` call:

```ts
telegramAssistant,
```

## Test Plan

No live Telegram messages are required for the implementation gate.

- Store tests with Vitest:
  - `put` stores with a 2-minute default TTL.
  - `get` returns null after TTL and removes expired entries.
  - `consume` returns the entry once, then returns missing/consumed on repeat.
  - duplicate unexpired challenge ID is rejected.
- Route tests with Fastify injection:
  - Non-loopback request is rejected with `403 {ok:false,error:"loopback_required"}`.
  - `chatId !== 1000000001` is rejected with `4xx {ok:false,error}` and does not call mocked Telegram.
  - Invalid buttons/displayNumber/challengeId/callbackUrl return `4xx {ok:false,error}`.
  - Valid request stores the challenge, calls mocked `sendHelmChallenge`, and returns `200 {ok:true}`.
- Verdict tests without real Telegram:
  - Matching selected number yields `"pass"`.
  - Wrong selected number yields `"fail"`.
  - Missing/expired consume result stops without webhook.
  - Double consume cannot double-fire a webhook in the callback helper path.
- Existing `weblogin:` behavior:
  - Add or preserve a focused callback test showing `weblogin:` still calls `core.handleCommand("/weblogin <hours>")`.

## Commands

Run:

```bash
npm test
npm run build
```

## Risks And Guards

- Test mode has `telegramAssistant === null`; route returns `503` rather than pretending a challenge was sent.
- Consuming before webhook POST makes the one-shot/idempotency guarantee strong, at the cost of no retry after Helm webhook failure. This matches the contract requirement to tolerate webhook failure without double-firing or crashing.
- The shared singleton is process-local only, which matches the contract's in-memory TTL requirement.
- The Telegram callback path must not keep the current top-level `if (!query.data?.startsWith("weblogin:")) return;` ahead of `helmpwl:`; that is the main regression guard.
