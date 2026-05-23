# Validation — Batch A7 (R10, R11, completes R14) — VERDICT: PASS

Independent verification by projcore. Stage A complete.

| Gate | Result |
|------|--------|
| 1. Artifacts | PASS — changes/test-report/independent-validation present |
| 2. Diff review | PASS — app.js (+158, Workflows nav+panel+WS subscribe+poll fallback), overmind-helpers.js (NEW plain .js ESM, 7 exports), style.css (+139), overmind-stream-manager.ts (NEW, 75L), /ws/overmind route, watcher onUpdate broadcast (+5). Tight |
| 3. Build | PASS — tsc exit 0 |
| 4. Targeted tests | PASS — overmind-stream 6/6 |
| 5. Evidence (5Q) | PASS — helpers .js valid ESM (7 exports), app.js imports them + wires #/overmind + GET fetch + WS; /ws/overmind route + OvermindStreamManager registered. **Live (after deploy fix):** app.js=200, overmind-helpers.js=200, GET auth-gated (401), boot OK. Residual: browser DOM render not checkable headless — JROM should eyeball #/overmind once |
| 6. Req coverage | R10 VERIFIED (panel), R11 VERIFIED (WS stream + broadcast), R14 VERIFIED (tasklist done/processing/pending display complete) |
| 7. Decisions | PASS — helpers as plain .js (no-build-step) per projcore steer; deploy-command correction logged |

## Process defect caught + fixed (projcore's, not A7's)
First UI smoke: `overmind-helpers.js=404` while app.js=200. Root cause: I'd been deploying with bare `npx tsc` instead of `npm run build` (= `tsc && cp -r src/web dist/`). The static root is `dist/web/public`; the backend (dist/index.js) was rebuilt by tsc so all EARLIER backend smokes were valid, but static frontend was stale. Fixed by running `npm run build`. **Going forward the deploy/smoke command is `npm run build` (then pm2 restart), NOT `npx tsc`.**
