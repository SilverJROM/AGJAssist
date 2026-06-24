# SHARED CONTRACT — Helm passwordless TG login via AGJAssist bot
# Version 1.0 — 2026-06-24 — both sides build EXACTLY to this. Do not change without updating both teams.

## Goal
JROM clicks "Login via Telegram" on Helm → a 2-digit number shows on screen → his Telegram bot shows 3
number buttons → he taps the matching one → he's logged into Helm. No password typed.

## Roles
- **Helm** (Fastify + better-sqlite3, http://127.0.0.1:3110) = AUTH AUTHORITY. Generates the challenge,
  shows the number, issues the owner JWT on success.
- **AGJAssist** (http://127.0.0.1:3101, owns the Telegram bot, BOT_TOKEN, `bot.on("callback_query")`) =
  TG TRANSPORT + VERDICT. Sends the number-match to TG, reads the tap, decides pass/fail, calls Helm back.
- Owner Telegram chat_id = **1000000001** (silverJROM, from agjDb users).

## Endpoints (all loopback-only; guard with each app's existing loopback preHandler)

### 1. Helm → AGJAssist : start the TG challenge
`POST http://127.0.0.1:3101/api/tg/login-challenge`
Request JSON:
```
{
  "challengeId":  "<uuid>",          // Helm-generated, unguessable
  "chatId":       1000000001,        // owner TG id
  "displayNumber": 42,               // the CORRECT number (Helm-generated)
  "buttons":      [42, 17, 88],      // the 3 shuffled buttons (display + 2 decoys), 2-digit each
  "prompt":       "Sign-in attempt for Helm — tap the number you see on screen:",
  "callbackUrl":  "http://127.0.0.1:3110/api/auth/tg-callback"   // where AGJAssist POSTs the verdict
}
```
Response: `200 {"ok":true}` on accepted (TG message sent), else `4xx {"ok":false,"error":"..."}`.
AGJAssist stores `{challengeId → displayNumber, callbackUrl}` in memory with a 2-min TTL, sends the TG
message to chatId with an inline keyboard: each button `text=String(n)`, `callback_data="helmpwl:<challengeId>:<n>"`.
AGJAssist MUST only send to the owner chatId; reject any other chatId.

### 2. JROM taps a number in Telegram → AGJAssist callback_query handler
AGJAssist's existing `bot.on("callback_query")` recognizes `data` starting with `helmpwl:`.
Parse `helmpwl:<challengeId>:<selected>`. Look up the stored challenge.
- not found / expired  → answer toast "Expired", stop.
- selected === displayNumber → result = "pass"
- else                        → result = "fail"
Edit the TG message ("✅ Signed in to Helm" / "❌ Sign-in denied"); answer the callback toast.
Then call the webhook (step 3). Consume the challenge (one-shot).

### 3. AGJAssist → Helm : deliver the verdict (the webhook)
`POST http://127.0.0.1:3110/api/auth/tg-callback`
Request JSON:
```
{ "challengeId": "<uuid>", "result": "pass" | "fail" }
```
Response: `200 {"ok":true}`. Helm marks the challenge approved/denied (only if it exists + is pending +
not expired). Idempotent (ignore duplicate/late callbacks).

### 4. Helm web : start + poll (Helm-internal, owner UI)
- `POST http://127.0.0.1:3110/api/auth/tg-login-start` (no auth — it's the login)
  → Helm generates challengeId(uuid) + displayNumber(2-digit) + 2 decoys, shuffles buttons, stores a
    challenge row (TTL 2 min, status=pending), calls endpoint #1, returns `{challengeId, displayNumber}`.
- `GET http://127.0.0.1:3110/api/auth/tg-status?challengeId=<id>`
  → `{status:"pending"|"pass"|"fail"|"expired"}`. On first read of "pass", Helm issues the owner JWT
    (reuse AuthService.issueOwnerToken()) and returns `{status:"pass", token, user}`.
- Login screen: "Login via Telegram" button → calls start → shows displayNumber big on screen + "Open
  Telegram and tap this number" → polls tg-status every ~2s until pass/fail/expired → on pass, store
  token (same as the existing credential-login success path) and enter the app.

## Security / rules
- All 3 inter-app calls are loopback-only (reject non-127.0.0.1). challengeId is a server UUID (unguessable).
- TTL 2 min on both sides. One-shot: a consumed challenge cannot be reused.
- AGJAssist only ever messages the owner chatId 1000000001.
- Keep the existing static-credential login (`JROM-OWNER-SECRET-2026` / HELM_OWNER_CRED) as a fallback path.
- No user enumeration concerns (single known owner).

## Test (live, end-to-end — the acceptance)
1. Open Helm login, click "Login via Telegram".
2. A 2-digit number appears on screen; JROM's Telegram shows 3 buttons.
3. JROM taps the matching number → TG shows "✅ Signed in to Helm"; Helm screen flips to logged-in within ~2s.
4. Tapping a WRONG number → "❌ denied", Helm shows fail, no token issued.
5. Letting it sit >2 min → "expired", no login.

## Build split
- **AGJAssist side (agj-4 session, acting as projcore):** endpoint #1 (send), the `helmpwl:` branch in
  callback_query (#2), the webhook POST to Helm (#3). In-memory challenge store + TTL. Topology:
  implementer=codex55, validator=sonnet, co-planner=codex55.
- **Helm side (this projcore):** challenge table (helm.db) + #4 (start/status) + #3 receiver +
  login UI/polling + issue owner JWT on pass. Topology: implementer=codex55, validator=sonnet,
  co-planner=codex55.
