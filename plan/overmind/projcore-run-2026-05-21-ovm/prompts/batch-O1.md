Batch-O1: Operator-control HTTP endpoints (pause/resume/drop) — localhost + OVERMIND_TOKEN

Batch ID: O1
Requirements: plan/overmind/projcore-run-2026-05-21-ovm/og-requirements-ovm.md (OU1)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

Context: the OVM operator brain (a claude session, later batches) will ADJUST workflows via curl. It needs token-guarded localhost endpoints for the controls that currently only exist as Telegram commands (pause/resume/drop). register/tasks already exist (localhost+OVERMIND_TOKEN); rename exists (JWT). Add the missing control endpoints with the SAME localhost+OVERMIND_TOKEN guard as register/tasks (see src/api/routes/overmind-routes.ts requireLoopbackAndToken or equivalent).

Requirement (OU1): "token-guarded localhost endpoints: POST /api/overmind/workflows/:id/pause, POST /api/overmind/workflows/:id/resume, DELETE /api/overmind/workflows/:id (drop). bad/no token → 401."

Expected (acceptance):
1. POST /api/overmind/workflows/:id/pause {token} → overmindService.setStatus(id,'paused') → returns updated workflow. 401 on bad/missing token; 404 unknown id.
2. POST /api/overmind/workflows/:id/resume {token} → setStatus(id,'active') → updated workflow. 401/404 likewise.
3. DELETE /api/overmind/workflows/:id (token in body or header) → overmindService.delete(id) → {ok:true}. (History archive table is NOT deleted — confirm delete() already preserves history from W4.) 401/404.
4. Use the EXISTING localhost+OVERMIND_TOKEN guard pattern (same as register/complete/tasks). Do NOT use JWT for these (the OVM brain curls them locally with the token).
5. npx tsc clean.

Likely files: src/api/routes/overmind-routes.ts (3 routes reusing the token+loopback guard), tests/overmind-routes.test.ts (extend).
Scope: these 3 control endpoints ONLY. Don't touch the session manager/UI (O2/O3) or other behavior. Surgical.
Tests: pause→paused, resume→active, drop→deleted (and history rows survive), token 401, unknown 404. Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + overmind-routes.ts (the token/loopback guard + existing register/tasks routes) + overmind-service.ts (setStatus/delete). Reply STATUS: PROPOSED with the 3 route signatures + guard reuse + tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-O1/changes.md + test-report.md + independent-validation.md.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O1 <STATE> <note>, THEN STATUS: <verb> -- reason.
