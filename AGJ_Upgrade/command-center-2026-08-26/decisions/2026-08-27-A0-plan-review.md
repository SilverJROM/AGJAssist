# Decision — A0 RAISE-A0-c1 PLAN REVIEW (no north escalate)

Date: 2026-08-27 · `[projcore]`

Driver EXIT `terminal_drain=true` with `pending_remaining=36` / `run_complete=false`. A0 parked after a1–a3 FAIL, PLAN REVIEW REQUIRED, same signature `GAP_INTERCEPTION|A5`.

**What "done" means:** product A5 unchanged (B8/G2). A0 done = `--harness-smoke` exit 0 (named-red on HEAD + stub A2 named-assert). Not a requirements/scope change.

**Why not north:** charter escalate-if-done-meaning-changes. This is criterion-to-slice misassignment plus listed harness impl gaps. 3 rounds exhausted the *wrong gate* (product A5 green) mixed with a real in-process-stub gap. Retry is after repairing that mapping, not another seat on the same unsatisfiable AC.

Action: RETRY_WITH_DIRECTION + cherry-pick `refs/tiller/command-center-2026-08-26/A0` + five a3 findings. Then `tiller resume`.
