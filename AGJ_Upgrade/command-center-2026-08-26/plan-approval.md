# Plan Approval — agjassist-command-center

STATUS: APPROVED-BY-NORTH

_North gate, 2026-08-27, plan rev3 (A0 plan-defect fix). Tiller is CLEARED TO RE-DRAIN from the top._

## What changed since the rev2 approval and why
The first drain stalled: A0 (fence harness) failed identically at glimmer→terra→sonnet5 because its `acs`
pointed at **A5**, a post-teardown *product* criterion a harness-only slice cannot satisfy (AC drift). North
ruled it a plan defect (`decisions/2026-08-27-a0-plan-defect-ruling.md`), voided the rev2 approval, and held
the gate (that HOLD correctly SIGTERM'd an in-flight driver that had re-launched on the stale approval — the
gate did its job).

## Verified in rev3 (both north concerns closed)
- **A0 `acs`: A5 → `HARNESS-SMOKE`.** The row scope now reads "HARNESS-CORRECTNESS ONLY. Validator gates this
  row on `--harness-smoke` exit 0, NEVER on A5." A5 stays owned by B8/G2. A0 is now **satisfiable** — the
  ladder can land it. ✓
- **FENCE_STUB interception** is correctly scoped as A0's remaining *implementation* work (projcore was honest
  that the recovered HEAD `3439337` still has the HTTP-proxy interception = the INTERCEPTION_GAP). It is gated
  by the now-correct `--harness-smoke` (which requires a working in-process stub to force a named red), so the
  implementer must fix it to pass — the gate enforces it. ✓

## Unchanged from the rev2 approval (still in force)
Fence gates = positive PASS + `FENCE_STUB` named-`kind=assert` red; A0 `--harness-smoke` correctness gate;
per-slice `cc-run-isolated.mjs` teardown + `reclaimed_bytes`; **G2 live-release human-gate MECHANISM** (TTY +
typed confirmation + no `TILLER_*` env, with a refuse-under-tiller test); tiller **build/test/dry-run only**,
no live DB/pm2, F-OVM fence-before-deploy. Owner-only + do-not-regress band hold.

**Tiller is authorized to re-drain from A0. Proceed.**
