# PLAN VERDICT — APPROVED-PLAN (with 3 deltas)

Coordinator (projcore) gate on `decisions/PLAN.md` (codex55 PROPOSED), 2026-06-24.

## Verdict: APPROVED-PLAN

Plan is faithful to CONTRACT.md v1.0. Bridge A (TelegramAssistant → ApiServices + `sendHelmChallenge`) is the right call. Store semantics (2-min TTL, sweep-on-access, atomic one-shot consume) and the callback-ordering regression guard (`helmpwl:` branched BEFORE the `weblogin:` early return) are correct. Loopback callbackUrl validation (anti-SSRF) is a good extra. Owner-only via `core.isAuthorized` + route-sends-only-to-owner is sound defense-in-depth.

## 3 deltas required before/while implementing

1. **Test location = repo convention.** Existing tests live FLAT in `tests/` (e.g. `tests/overmind-stream.test.ts`, `tests/app-settings-service.spec.ts`). Put new tests as `tests/helm-login-store.spec.ts`, `tests/tg-login-routes.test.ts`, `tests/helm-login-verdict.spec.ts` — NOT in `tests/unit/` or `tests/api/` subfolders. Framework is **Vitest** (confirmed) — your `vi`/`describe`/`it` + Fastify `app.inject()` approach is correct.

2. **Commands:** `npm test` (= `vitest run`) and `npm run build` (= `tsc -p tsconfig.json && cp -r src/web dist/`). Drop `--runInBand` (Vitest doesn't take it).

3. **Surface TG send failure (contract "else 4xx").** `sendHelmChallenge` must NOT swallow send errors via `sendMessageSafe`. Run the real `this.bot.sendMessage(...)` in a try and propagate failure (throw or return false) so the route returns `4xx`/`502 {ok:false,error:"telegram_send_failed"}` when the send genuinely fails. Accepted path still returns `200 {ok:true}`. (The `503 telegram_unavailable` in test-mode/null-bot is fine and stays.)

Everything else in PLAN.md stands. Proceed to implement.
