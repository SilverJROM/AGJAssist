# Callbacks — AGJ Spark Daemon Run (Internal projcore channel)
**This file:** projcore ↔ AGJ-codex callback channel (implementer writes here during batch work)
**Supervisor channel:** `../supervisor-callbacks/callbacks.md` (boundary markers only)

[projcore callback] batch-b1 DONE daemon skeleton, singleton lock, once/default loop, artifacts, tests, and commit complete
[projcore callback] batch-b12a PROPOSED additive schema v27 plan ready; awaiting APPROVED-PLAN
[projcore callback] batch-b12a APPROVED-PLAN implementing additive schema v27 migration on explicit paths only
[projcore callback] batch-b12a DONE schema v27 additive overmind_projects + nullable workflow project_id migration committed at 32a19e2
[projcore callback] batch-b12a VALIDATED PASS independent real migration passed; schema v27 additive checks satisfied
[projcore callback] batch-b12b PROPOSED shared is_agent_pane classifier plan ready; awaiting APPROVED-PLAN
[projcore callback] batch-b12b APPROVED-PLAN implementing bash+TS parity classifier only
[projcore callback] batch-b12b DONE is_agent_pane bash+TS parity classifier committed at 2a2ca29
[projcore callback] batch-b12b VALIDATED PASS bash+TS parity verified across claude/codex/bare-bash/unknown/no-session at commit 2a2ca29
[projcore callback] batch-b12c PROPOSED workflow identity retrofit v28 table rebuild + workflow_id/run_dir resolver plan ready; awaiting APPROVED-PLAN
[projcore callback] batch-b12c APPROVED-PLAN implementing v28 explicit-column rebuild + workflow_id/run_dir lifecycle lookup
[projcore callback] batch-b12c DONE workflow identity retrofit committed; v28 rebuild row-survival tests + workflow_id/run_dir lifecycle tests passing
[projcore callback] batch-b12c VALIDATED PASS real seeded v27->v28 migration preserved all rows/columns; constraints, resolver, build, targeted tests pass
[projcore callback] batch-b12d PROPOSED owner-JWT-only project create route + overmind_projects service plan ready; awaiting APPROVED-PLAN
[projcore callback] batch-b12d APPROVED-PLAN implementing owner-JWT-only POST /api/overmind/projects; loopback token is never accepted for mutation
[projcore callback] batch-b12d DONE owner-JWT-only POST /api/overmind/projects + overmind_projects service helpers committed; targeted route/service tests and build pass
[projcore callback] batch-b12d VALIDATED PASS owner JWT creates with created_by forced; loopback-token-only and viewer JWT are 403; no-auth 401; dup/bad-path checks pass
[projcore callback] batch-b12e PROPOSED GET/PATCH/DELETE overmind_projects route plan ready; awaiting APPROVED-PLAN
[projcore callback] batch-b12e APPROVED-PLAN implementing GET/PATCH/DELETE overmind_projects routes with shared active-runs count guard
[projcore callback] batch-b12e DONE GET/PATCH/DELETE overmind_projects routes committed; targeted route/service tests and build pass
[projcore callback] batch-b12e VALIDATED PASS real dist app.inject CRUD validation passed; read counts, owner-only mutations, immutable fields, 409 active-run guard, 404s, build, and targeted tests pass
[projcore callback] batch-b12f PROPOSED Dual-shape register plan ready: legacy label+session preserved; new run_dir-only attach walks projects and returns 201/404/422. DISPATCH-MARKER: AGJ-B12F
[projcore callback] batch-b12f APPROVED-PLAN Implementing run_dir-only attach with legacy register preserved. DISPATCH-MARKER: AGJ-B12F
[projcore callback] batch-b12f DONE Implemented run_dir-only project attach with 422/404 responses, project/run_dir idempotent upsert, legacy register preserved, tests/build green. DISPATCH-MARKER: AGJ-B12F
[projcore callback] batch-b12f VALIDATED PASS real dist app.inject confirms attach idempotent/no-dup, required 404/422 bodies, legacy register, omitted-tasks preserve, and child-add/rm compatibility. DISPATCH-MARKER: AGJ-VAL-B12F
[projcore callback] batch-b12g PROPOSED attach warn-check after registerAttached; persist on existing parent_status and return parent_warning for bare-bash/no-session; awaiting APPROVED-PLAN. DISPATCH-MARKER: AGJ-B12G
[projcore callback] batch-b12g DONE attach register parent warn-check implemented; bare-bash/no-session warn-only 201 with persisted parent_status + parent_warning, detector failures fall back to unknown/no warning; targeted tests and build green. DISPATCH-MARKER: AGJ-B12G
[projcore callback] batch-b12g VALIDATED PASS real dist app.inject confirms agent ok, bare-bash/no-session warn-only 201 persisted, detector unavailable unknown non-fatal, legacy path untouched. DISPATCH-MARKER: AGJ-VAL-B12G
[projcore callback] batch-b12h PROPOSED register --run-dir-only client rewrite scoped to cmd_register; old identity flags hard-reject before POST; 404 writes REGISTER-REJECTED to run callbacks; bash -n and stubbed 201/404 tests planned. DISPATCH-MARKER: AGJ-B12H
[projcore callback] batch-b12h APPROVED-PLAN implementing cmd_register-only live overmind.sh change with hard diff gate and bash -n. DISPATCH-MARKER: AGJ-B12H
[projcore callback] batch-b12h DONE live overmind.sh cmd_register now run-dir-only with old flag rejection, workflow_id storage, 404 REGISTER-REJECTED callback; bash -n, stubbed 201/404, and byte-identical non-register verb diff gate passed. DISPATCH-MARKER: AGJ-B12H
[projcore callback] batch-b12h VALIDATED PASS cmd_register-only live change verified; bash -n clean; legacy flags reject before POST; 201 stores workflow_id; 404 writes REGISTER-REJECTED callback; non-register verbs byte-identical. DISPATCH-MARKER: AGJ-VAL-B12H
[projcore callback] batch-b12i PROPOSED hook outbound overmind parent sends through project parent resolver + is_agent_pane precheck; suppress/orphan/TG-once design ready; awaiting APPROVED-PLAN. DISPATCH-MARKER: AGJ-B12I
[projcore callback] batch-b12i APPROVED-PLAN implementing shared parent-nudge guard with in-memory NudgeStateService debounce; route corrective/child-close sends out of scope. DISPATCH-MARKER: AGJ-B12I
[projcore callback] batch-b12i DONE shared parent-nudge guard implemented; project parent resolver + legacy fallback; bare-bash/no-session suppress with parent_status + TG once; targeted guard tests and build green. DISPATCH-MARKER: AGJ-B12I
[projcore callback] batch-b12i VALIDATED PASS parent guard suppresses bare-bash/no-session with TG-once debounce, allows agent/legacy sends, and all nudge chokepoints route through guard; build and targeted tests pass. DISPATCH-MARKER: AGJ-VAL-B12I
[projcore callback] batch-b12j PROPOSED Add distinct /overmind-projects bottom-nav dashboard page with GET list, owner-JWT create modal, mapped 409/400/403 UI errors, and app-level create-flow proof. DISPATCH-MARKER: AGJ-B12J
[projcore callback] batch-b12j APPROVED-PLAN Implementing distinct /overmind-projects dashboard list/create UI using existing app.js + bottom-nav conventions. DISPATCH-MARKER: AGJ-B12J
[projcore callback] batch-b12j DONE distinct OVM Projects tab/page implemented; list + owner-JWT create modal verified via Playwright, DB row, 409/400/403 UI errors, build, and targeted tests. DISPATCH-MARKER: AGJ-B12J
[projcore callback] batch-b12j VALIDATED PASS distinct /overmind-projects tab/page verified; fallback app.inject create returned 201, follow-up list row and SQLite DB row existed, errors surfaced by UI code, build green. DISPATCH-MARKER: AGJ-VAL-B12J
[projcore callback] batch-b12k PROPOSED edit/delete modal plan plus minimal latest_parent_status read-shape for warn tile; waiting for APPROVED-PLAN. DISPATCH-MARKER: AGJ-B12K
[projcore callback] batch-b12k DONE edit modal, delete 409/success handling, latest_parent_status warning tile, route test, build, and localhost:3101 screenshots complete. DISPATCH-MARKER: AGJ-B12K
[projcore callback] batch-b12k VALIDATED PASS app.inject + DOM/bundle read confirms immutable edit fields, PATCH/list reflection, delete 200 removal, delete 409 row retention, latest_parent_status warning behavior, and build green. DISPATCH-MARKER: AGJ-VAL-B12K
[projcore callback] batch-b12l PROPOSED Read R12.5/docs and ran npx vitest run tests/overmind*.test.ts first; saw expected stale prefix/copy failures plus additional non-string parent-nudge fixture failures needing scope confirmation.
[projcore callback] batch-b12l DONE commit 79e9a51; docs synced, parent-guard fallout fixed, npx vitest run tests/overmind*.test.ts green, npm run build green.
[projcore callback] batch-b12l VALIDATED PASS overmind suite 17/17 files and 302/302 tests passed, build passed, refreshed tests preserve behavior, guard degrades to send/unknown, docs match R12.5. DISPATCH-MARKER: AGJ-VAL-B12L
[projcore callback] batch-b12m PROPOSED Implement src/tools/propose-overmind-projects.ts with completed-only query, canonical app_path grouping, dry-run curl output, fail-closed owner-JWT commit, and fixture tests. DISPATCH-MARKER: AGJ-B12M
[projcore callback] batch-b12m DONE completed-workflows-only migration proposer committed at 62d02d0; dry-run default, review-needed rows, slug-conflict exclusion, fail-closed --commit, fixture tests, and build pass. DISPATCH-MARKER: AGJ-B12M
[projcore callback] batch-b12m VALIDATED PASS temp fixture dry-run was completed-only with zero HTTP; missing run_dir review-needed; slug conflicts excluded from commit; 403 commit preflight fail-closed; tests/build green. DISPATCH-MARKER: AGJ-VAL-B12M
[projcore callback] batch-b12n PROPOSED live :3101 overmind project endpoints verified by read-only probe (401 unauth, 200 token-read); propose live-supported path with AGJ project create plus separate disposable attached run only; wf=4 untouched, no :3101 restart. DISPATCH-MARKER: AGJ-B12N
[projcore callback] batch-b12n APPROVED-PLAN executing live-supported safe T12.10 proof: owner JWT shell-var only, AGJ verify/create, separate disposable run attach, cleanup throwaway only; wf=4/live run_dir/:3101 untouched. DISPATCH-MARKER: AGJ-B12N
[projcore callback] batch-b12n DONE live AGJ project created on :3101, disposable workflow 13 attached under AGJ then deleted, AGJ left in place, wf=4/live run_dir/:3101 untouched; B12n artifacts and decision logs written. DISPATCH-MARKER: AGJ-B12N
