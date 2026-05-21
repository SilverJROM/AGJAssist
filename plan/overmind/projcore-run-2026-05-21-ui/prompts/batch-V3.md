Batch-V3: Dashboard Active / Done tabs

Batch ID: V3
Requirements: og-requirements-ui.md (RU4), north-star-ui.md (UI-NS-2)
Branch: feat/overmind (CONTINUE)

Estimated: SHORT (<30min).

Context:
#/overmind (src/web/public/app.js OvermindWorkflows) renders all registered workflows as cards (now collapsible w/ status colors from V1). RU4: split them into two tabs.

Requirement (verbatim, RU4):
"Two tabs on the #/overmind view: Active = workflows currently in play (active|working|waiting_human|awaiting_decision|stuck); Done = completed|paused. Default to Active. Show counts per tab."

Expected (acceptance):
1. OvermindWorkflows shows two tabs: "Active" and "Done", with counts (e.g. "Active (1)" / "Done (2)").
2. Active tab lists workflows with status in {active, working, waiting_human, awaiting_decision, stuck}; Done tab lists {completed, paused}. Default selected = Active.
3. Tab state in component useState. Filtering is pure (extract a helper like isActiveStatus(status) in overmind-helpers.js, node-testable).
4. Empty-state per tab ("No active workflows" / "No done workflows").
5. Keep V1 collapse + V2 attribution intact within each tab. Density-light, consistent style.css.
6. npx tsc clean.

Likely files:
- src/web/public/app.js (tabs + filtering)
- src/web/public/overmind-helpers.js (isActiveStatus / partition helper)
- src/web/public/style.css (tab styles)
- tests/overmind-stream.test.ts (extend: isActiveStatus mapping)

Scope: tabs ONLY. Don't touch nav (V4), audit (V6), backend. UI only. Surgical.

Tests: assert isActiveStatus: working/active/waiting_human/awaiting_decision/stuck → active; completed/paused → done. Run targeted test + tsc + npm run build.

Plan handshake (MANDATORY): read brief + og/north-star + app.js (OvermindWorkflows) + overmind-helpers.js. Reply STATUS: PROPOSED with the tab structure + filter helper + counts approach. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement, commit, gate (test + tsc + npm run build). Artifacts batch-V3/changes.md + test-report.md + independent-validation.md.

Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ui/callbacks.md `[projcore callback] V3 <STATE> <note>`, THEN STATUS: <verb> -- reason.
