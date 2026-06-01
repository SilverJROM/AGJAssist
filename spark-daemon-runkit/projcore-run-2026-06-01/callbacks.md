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
