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
