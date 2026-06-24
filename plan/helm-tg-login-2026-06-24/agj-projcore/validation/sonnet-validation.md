# Independent Validation — AGJAssist Helm Passwordless TG Login
Validator: sonnet (verifier ≠ fixer)
Date: 2026-06-24

---

## 1. Own test + build run

```
npm test
  Test Files  55 passed (55)
       Tests  650 passed | 1 skipped (651)
  Start at  11:12:20
  Duration  5.49s
  Exit code: 0

npm run build
  tsc -p tsconfig.json && cp -r src/web dist/
  Exit code: 0
```

Matches codex55 claim exactly. No test failures, no type errors.

---

## 2. Contract conformance — piece by piece

### Piece 1 — `POST /api/tg/login-challenge` (`src/api/routes/tg-login-routes.ts`)

**Loopback guard:** PASS
- `requireLoopback` preHandler at `tg-login-routes.ts:25-33`, applied at `tg-login-routes.ts:59`.
- `isLoopbackAddress` at `tg-login-routes.ts:17-23` accepts `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, any `127.*`.
- Direct socket address checked first (`request.raw.socket.remoteAddress`); `x-forwarded-for` is only a final fallback if both direct+request.ip are null — same pattern as the established `agent-routes.ts:18-28` with identical comment. Non-loopback returns `403 {ok:false,error:"loopback_required"}`.
- Test coverage: `tg-login-routes.test.ts:79-90` (`remoteAddress: "10.0.0.5"` → 403). PASS.

**Owner chatId rejection:** PASS
- `tg-login-routes.ts:73`: `body.chatId !== config.telegram.authorizedUserId` → 400 `{ok:false,error:"invalid_chat_id"}`. Config in test: `authorizedUserId: 1000000001`.
- Never calls `sendHelmChallenge` on bad chatId. Test: `tg-login-routes.test.ts:92-103`. PASS.

**Two-digit displayNumber validation:** PASS
- `isTwoDigitInteger` at `tg-login-routes.ts:35-38`: `Number.isInteger && >= 10 && <= 99`. Single-digit (7) returns 400 `invalid_display_number`. Test: `tg-login-routes.test.ts:116-124`. PASS.

**Buttons validation (3 two-digit ints, includes displayNumber):** PASS
- `tg-login-routes.ts:83-91`: array of exactly 3, all `isTwoDigitInteger`, includes displayNumber. Test: `tg-login-routes.test.ts:106-126`. PASS.

**2-minute TTL stored:** PASS
- `src/bot/helm-login-store.ts:1`: `export const HELM_LOGIN_TTL_MS = 120_000`.
- Route calls `helmLoginChallengeStore.put({challengeId, displayNumber, callbackUrl})` — no custom ttlMs, so default 120,000ms applied at `helm-login-store.ts:39`: `expiresAt: now + (input.ttlMs ?? HELM_LOGIN_TTL_MS)`.
- Test: `helm-login-store.spec.ts:16-33` ("stores challenges with the default two-minute TTL"). PASS.

**Inline keyboard callback_data format:** PASS
- `telegram-bot.ts:51-54`:
  ```ts
  callback_data: `helmpwl:${input.challengeId}:${n}`
  text: String(n)
  ```
  Exact format `helmpwl:<challengeId>:<n>` per contract. All 3 buttons in a single row. PASS.

**Sends to owner chatId only:** PASS
- Route only reaches `sendHelmChallenge` after validating `body.chatId === config.telegram.authorizedUserId`. The bot's `sendHelmChallenge` sends to `input.chatId` (the already-validated owner chatId). No path can send to a non-owner chatId.

**Anti-SSRF callbackUrl guard:** PASS (extra protection beyond contract)
- `tg-login-routes.ts:39-46` (`isLoopbackHttpUrl`): validates `protocol === "http:"` and loopback hostname before storing. Rejects non-loopback or non-http callbackUrls with 400 `invalid_callback_url`.

**TG send failure → 502:** PASS
- `sendHelmChallenge` at `telegram-bot.ts:45-61` uses `this.bot.sendMessage(...)` directly (not `sendMessageSafe`), re-throws on failure. Route catches at `tg-login-routes.ts:126-130`, calls `helmLoginChallengeStore.consume(challengeId)` to roll back, returns `502 {ok:false,error:"telegram_send_failed"}`.
- Test: `tg-login-routes.test.ts:151-168` — also verifies `get("challenge-1")` returns null after failed send (rollback confirmed). PASS.

**503 telegram_unavailable for null bot (test mode):** PASS
- `tg-login-routes.ts:102-105`. PASS.

**409 challenge_exists on duplicate:** PASS
- `tg-login-routes.ts:113-117`. PASS.

**200 {ok:true} on accept:** PASS
- `tg-login-routes.ts:133`. Test: `tg-login-routes.test.ts:128-149`. PASS.

---

### Piece 2 — `helmpwl:` callback branch (`src/bot/telegram-bot.ts`)

**CRITICAL: helmpwl: handled BEFORE the weblogin: early-return:** PASS
- `telegram-bot.ts:98-101`: `if (query.data?.startsWith("helmpwl:"))` → `handleHelmPasswordlessCallback(query); return;`
- `telegram-bot.ts:103`: `if (!query.data?.startsWith("weblogin:")) return;` — the existing early-return guard.
- The `helmpwl:` branch at line 98 exits before line 103 is ever reached. A `helmpwl:` payload can never be swallowed by the `weblogin:` early-return.

**Parse `helmpwl:<challengeId>:<selected>`:** PASS
- `telegram-bot.ts:174-185`: `split(":")` → expects exactly 3 parts (`["helmpwl", challengeId, selected]`). UUID challengeIds (no colons) work correctly. Bad format answers "Invalid" and stops. PASS.

**Owner authorization in callback:** PASS
- `telegram-bot.ts:169-171`: `core.isAuthorized(query.from.id)` checked first; unauthorized → "Unauthorized" toast + stop. PASS.

**Missing/expired → "Expired" toast + stop:** PASS
- `telegram-bot.ts:187-190`: `consume(challengeId)` on the store; if `!consumed.ok` → answers "Expired" + returns. Covers missing, expired, and already-consumed cases. PASS.

**Pass/fail verdict:** PASS
- `telegram-bot.ts:193`: `decideHelmLoginVerdict(consumed.challenge, selected)` — pure function returns `"pass"` if `selected === displayNumber`, else `"fail"`. Test: `helm-login-verdict.spec.ts:17-22`. PASS.

**Edit TG message — exact text:** PASS
- `telegram-bot.ts:208`: `"✅ Signed in to Helm"` (pass) / `"❌ Sign-in denied"` (fail). Exact strings match the contract. Called via `this.bot.editMessageText(...)` with `{chat_id, message_id}`. PASS.

**Answer callback toast:** PASS
- `telegram-bot.ts:195-197`: `answerCallbackQuerySafe(query.id, { text: result === "pass" ? "Signed in to Helm" : "Sign-in denied" })`. Called after editMessage, before webhook POST. PASS.

**One-shot consume (cannot double-fire):** PASS
- Store's `consume` at `helm-login-store.ts:59-79`: deletes entry from Map *before* checking expiry or returning result. First consume: returns `{ok:true}` + deletes. Second consume: entry not found → `{ok:false, reason:"missing"}` → handler toasts "Expired" and stops → `postHelmVerdict` never called.
- Test: `helm-login-store.spec.ts:52-71` ("consumes a challenge once"). PASS.

---

### Piece 3 — Verdict webhook POST (`telegram-bot.ts:217-231`)

**Correct payload:** PASS
- `postHelmVerdict` POSTs `{challengeId, result}` as JSON to stored `callbackUrl`. Matches contract `{challengeId, result:"pass"|"fail"}`. PASS.

**Idempotent (one-shot):** PASS
- Consume happens at `telegram-bot.ts:187` before `postHelmVerdict` is called at line 198. A second tap hits "missing" → handler returns before reaching `postHelmVerdict`. Double-POST is structurally impossible. PASS.

**Non-crashing on webhook failure:** PASS
- `telegram-bot.ts:217-231`: entire `fetch` call wrapped in `try/catch`; failure logs via `console.error` and does not rethrow. Handler continues normally. PASS.

---

## 3. Regression — weblogin: callback path

**PASS**
- `telegram-commands.test.ts:47-70`: fires `callback_query` handler with `data: "weblogin:2"`.
  - `core.isAuthorized(1000000001)` → true ✓
  - `core.handleCommand("/weblogin 2")` called ✓
  - `answerCallbackQuery("callback-1", undefined)` called ✓
  - `sendMessage(1000000001, "login-code-response", undefined)` called ✓
- The `helmpwl:` branch (line 98) does not intercept `weblogin:` data. Ordering confirmed: `weblogin:2` never matches `startsWith("helmpwl:")`, falls through normally to the weblogin branch at line 103.

---

## 4. Store semantics

| Semantic | Check | Result |
|---|---|---|
| TTL = 120,000ms | `HELM_LOGIN_TTL_MS = 120_000` at `helm-login-store.ts:1`; default applied at line 39 | PASS |
| Sweep-on-access | `get` sweeps at line 50-53; `put` sweeps at line 29 | PASS |
| Atomic consume | Map `delete` at line 63 before expiry check; JS single-threaded | PASS |
| Expired = null | `get` returns null and deletes if `expiresAt <= Date.now()` | PASS |
| Double-consume safe | After first consume, entry is gone → second returns `{ok:false,reason:"missing"}` | PASS |
| Duplicate rejection | `put` checks `has(challengeId)` after sweep; rejects with `{ok:false,reason:"duplicate"}` | PASS |

---

## 5. Security

| Check | Result |
|---|---|
| Loopback guard uses socket addr first (XFF-spoof resistant) | PASS — same pattern as `agent-routes.ts` |
| callbackUrl restricted to loopback HTTP (anti-SSRF) | PASS — `isLoopbackHttpUrl` enforced before store |
| Only owner chatId ever messaged | PASS — validated at route; `core.isAuthorized` also in callback |

---

## Gaps / Observations (non-blocking)

1. **No integration test for the full `handleHelmPasswordlessCallback` flow** (consume → editMessage → toast → webhookPOST in one end-to-end mock). The individual pieces are tested separately (store tests, verdict tests, route tests, regression test) and the code review confirms correct wiring. This is sufficient for the implementation gate; a full callback integration test would be a nice-to-have for a future hardening pass.

2. **`x-forwarded-for` fallback in loopback guard** — identical to the established `agent-routes.ts` pattern and effectively dead code when `socket.remoteAddress` is present (which it always is for TCP connections). Not a new deviation; not a risk in the current deployment.

Neither gap blocks PASS.

---

## Verdict summary

| Item | Result |
|---|---|
| npm test: 650/651 passed | ✅ PASS |
| npm run build: exit 0 | ✅ PASS |
| Piece 1: loopback guard | ✅ PASS |
| Piece 1: owner chatId only | ✅ PASS |
| Piece 1: 2-min TTL | ✅ PASS |
| Piece 1: inline keyboard callback_data format | ✅ PASS |
| Piece 1: 200/4xx/502 responses | ✅ PASS |
| Piece 1: anti-SSRF callbackUrl | ✅ PASS |
| Piece 2: helmpwl: BEFORE weblogin: early-return | ✅ PASS |
| Piece 2: parse + invalid handling | ✅ PASS |
| Piece 2: expired/missing → "Expired" toast | ✅ PASS |
| Piece 2: pass/fail verdict | ✅ PASS |
| Piece 2: edit message exact text | ✅ PASS |
| Piece 2: one-shot consume | ✅ PASS |
| Piece 3: correct webhook payload | ✅ PASS |
| Piece 3: idempotent (no double-POST) | ✅ PASS |
| Piece 3: non-crashing on failure | ✅ PASS |
| weblogin: regression | ✅ PASS |

---

VALIDATION: PASS
