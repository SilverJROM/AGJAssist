# CO-PLAN HANDSHAKE — AGJAssist side of Helm passwordless TG login

You are the **co-planner + implementer (codex55)** for the AGJAssist side of a cross-app feature.
I am the projcore coordinator. This is **Phase 0.5: co-plan ONLY — do NOT write code yet.**
Produce a PLAN, end with `STATUS: PROPOSED`. I validate → `APPROVED-PLAN` → then you implement.

## 1. Read the contract FIRST (locked, do not deviate)
`/home/agjrom/TGBOTS/AGJAssist/plan/helm-tg-login-2026-06-24/CONTRACT.md`

Build ONLY the **AGJAssist side = 3 pieces**:
1. `POST /api/tg/login-challenge` on :3101, **loopback-guarded** — stores `{challengeId → displayNumber, callbackUrl}` in memory with **2-min TTL**, sends owner TG (chat **1000000001**) a **3-button inline keyboard**, `callback_data="helmpwl:<challengeId>:<n>"`. Only ever message the owner chatId; reject any other chatId.
2. Extend the existing `bot.on("callback_query")` to handle the **`helmpwl:`** prefix — parse `helmpwl:<challengeId>:<selected>`, look up store; not-found/expired → toast "Expired" + stop; `selected===displayNumber` → pass else fail; **edit the TG message** (✅ Signed in to Helm / ❌ Sign-in denied); answer the toast; then POST verdict (piece 3); **consume the challenge (one-shot)**.
3. POST the verdict to the stored `callbackUrl` (Helm webhook `http://127.0.0.1:3110/api/auth/tg-callback`) as `{challengeId, result:"pass"|"fail"}` — **one-shot + idempotent** (don't double-fire; tolerate webhook failure without crashing the handler).

## 2. Integration map I already gathered — USE THIS, do not re-explore (save tokens)
- **Server:** Fastify, port 3101. Routes registered in `src/api/server.ts` via `registerXxxRoutes(app, services)`. Each route file exports `registerXxxRoutes`. `ApiServices` interface is in `server.ts` (~line 56). The `telegramAssistant` bot wrapper is **NOT** currently in `ApiServices`.
- **Bot:** `node-telegram-bot-api`, class `TelegramAssistant` in `src/bot/telegram-bot.ts`. `this.bot` = raw `TelegramBot`. `core` = `AssistantCore`. callback_query handler is at **lines 69–84** and currently `return`s unless `query.data.startsWith("weblogin:")` — your `helmpwl:` branch must be added so it is NOT swallowed by that early return. Existing helpers: `sendMessageSafe(chatId,text,opts)`, `answerCallbackQuerySafe(id,opts)`. There is **no** editMessageText wrapper yet — call `this.bot.editMessageText(text,{chat_id,message_id})` (message_id comes from `query.message.message_id`), wrapped in try/catch.
  - Existing inline-keyboard example: `telegram-bot.ts:99-110` (reply_markup.inline_keyboard with `callback_data`).
- **Loopback guard:** `isLoopbackAddress(ip)` + preHandler pattern in `src/api/routes/agent-routes.ts:10-28`; same pattern in `overmind-routes.ts:235-279` (`requireLoopbackAndToken`). Reuse the **pure-loopback** variant (contract says loopback-only, no token).
- **Outbound POST:** native `fetch` (e.g. `src/index.ts:170-179`).
- **In-memory TTL store precedent:** `src/auth/auth-service.ts:33,42-59` (Map with `expiresAt`, sweep-expired-on-access).
- **Owner id:** `config.telegram.authorizedUserId === 1000000001` (`.env:2`, `config.ts:75`). The bot owns `core.isAuthorized(id)`.

## 3. The ONE design decision to resolve in your PLAN (the wiring bridge)
The route (in the Fastify server) must (a) store the challenge and (b) trigger the bot to send the TG message. The bot's callback handler must read the SAME store and post the webhook. Two concerns:
- **Shared store:** propose a single module (e.g. `src/bot/helm-login-store.ts`) exporting a singleton with `put/get/consume/sweep` + 2-min TTL, imported by BOTH the route and the bot handler. State the exact shape.
- **Route → bot bridge:** how does the route send the inline keyboard? Pick ONE and justify:
  - (A) Add `telegramAssistant` (with a new public `sendHelmChallenge(...)` method) into `ApiServices` and pass it at `src/index.ts:129`. Clean, uses the existing bot instance.
  - (B) Route sends via direct `fetch` to the Telegram `sendMessage` API. Decouples from bot, but duplicates token usage and the edit/answer still must live in the bot.
  Recommend (A) unless you see a blocker.

## 4. Your PLAN must specify
- Exact file list (new + modified) with what changes in each.
- The store module's exact interface + TTL/one-shot semantics.
- The wiring decision (A or B) + the 1–2 lines added to `server.ts` ApiServices + `index.ts:129`.
- Input validation for piece 1 (chatId===owner, buttons is 3 numbers incl displayNumber, challengeId present) and the 4xx error shape `{ok:false,error}`.
- **Test plan:** how you'll prove it without spamming real TG. Propose a TS unit/integration test for the store TTL/one-shot + the route's loopback-reject + bad-chatId-reject + the verdict-decision logic (pass/fail/expired). Live real-TG e2e is the joint acceptance with the Helm side — that's coordinated separately, not your gate.
- Build/typecheck command you'll run (the repo's tsc/test).

## 5. Constraints
- Keep the existing weblogin callback path 100% intact.
- Keep static-credential login untouched (Helm-side concern anyway).
- Atomic, tight diff. No refactors beyond the bridge.
- Do NOT implement yet. Write the plan to `plan/helm-tg-login-2026-06-24/agj-projcore/decisions/PLAN.md` and end your reply with `STATUS: PROPOSED`.
