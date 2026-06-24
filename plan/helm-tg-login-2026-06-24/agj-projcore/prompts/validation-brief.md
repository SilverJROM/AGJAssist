# VALIDATION BRIEF — AGJAssist side, Helm passwordless TG login

You are the INDEPENDENT VALIDATOR (verifier ≠ fixer). codex55 implemented; you independently verify. **Do NOT fix anything** — if something is wrong, report it; I route the fix back to codex.

## Inputs
- Contract (source of truth): `plan/helm-tg-login-2026-06-24/CONTRACT.md`
- Implementer's changes.md: `plan/helm-tg-login-2026-06-24/agj-projcore/changes.md`
- Approved plan + deltas: `decisions/PLAN.md` + `decisions/PLAN-VERDICT.md`

## Files changed (audit these)
New: `src/bot/helm-login-store.ts`, `src/bot/helm-login-verdict.ts`, `src/api/routes/tg-login-routes.ts`, `tests/helm-login-store.spec.ts`, `tests/helm-login-verdict.spec.ts`, `tests/tg-login-routes.test.ts`
Modified: `src/bot/telegram-bot.ts`, `src/api/server.ts`, `src/index.ts`, `tests/telegram-commands.test.ts`

## Your job — independently confirm (read the diff + re-run, do NOT trust the report)

1. **Re-run yourself:** `npm test` and `npm run build`. Confirm green with your OWN run (paste the real summary lines). codex claims 650 passed / 1 skipped + build ok.

2. **Contract conformance — piece by piece:**
   - **Piece 1 (`POST /api/tg/login-challenge`):** loopback-guarded (non-127.* → 4xx); rejects any `chatId !== 1000000001` (owner); validates `buttons` = 3 two-digit ints incl `displayNumber`; stores `{challengeId→displayNumber, callbackUrl}` with **2-min TTL**; sends inline keyboard with each button `callback_data="helmpwl:<challengeId>:<n>"`, `text=String(n)`; returns `200 {ok:true}` accepted / `4xx {ok:false,error}` rejected; `502 {ok:false,error:"telegram_send_failed"}` on real send failure.
   - **Piece 2 (`helmpwl:` callback):** branch is handled **BEFORE** the existing `if (!query.data?.startsWith("weblogin:")) return;` early-return (THE key regression guard — verify ordering in `telegram-bot.ts`); parses `helmpwl:<challengeId>:<selected>`; missing/expired → toast "Expired" + stop; `selected===displayNumber` → pass else fail; **edits the TG message** to exactly `✅ Signed in to Helm` / `❌ Sign-in denied`; answers the toast; **consumes one-shot** (a second tap cannot double-fire).
   - **Piece 3 (verdict webhook):** POSTs `{challengeId, result:"pass"|"fail"}` to the stored `callbackUrl`; one-shot + idempotent; webhook failure is caught and does NOT crash the handler.

3. **Regression:** the existing `weblogin:` callback path still works (still calls `/weblogin <hours>`). Confirm the new test asserts this AND that the ordering didn't break it.

4. **Store semantics:** 2-min (120_000ms) TTL real; sweep-on-access; `consume` atomic so a double tap can't double-POST; expired returns missing.

5. **Security:** loopback guard rejects non-127.*; callbackUrl restricted to loopback HTTP (anti-SSRF); only owner chatId ever messaged.

## Output
Write your verdict to `plan/helm-tg-login-2026-06-24/agj-projcore/validation/sonnet-validation.md`:
- Per-item PASS/FAIL with the evidence (file:line you checked, the test that covers it).
- Your own `npm test` + `npm run build` result lines.
- Any gap = FAIL item with the exact file:line and what the contract requires instead.
End your reply with `VALIDATION: PASS` or `VALIDATION: FAIL` (+ the failing items). Do NOT send real Telegram. Do NOT edit source.
