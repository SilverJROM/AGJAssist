# Decision — A0 plan-defect ruling (first tiller pass stalled)

Date: 2026-08-27 · logged by `[north]`

**The first tiller drain reached terminal with 0/36 done — stalled at A0**, the fence-harness slice. Because
every slice deps (transitively) on A0, A0 parking made the whole queue `NONE_DISPATCHABLE`.

## Root cause (driver + validator agreed)
A0 failed **identically** at glimmer (a1, IMPL_INCOMPLETE) → terra (a2) → sonnet5 (a3), all on
**req A5 / defect_class INTERCEPTION_GAP**, redteam standard-fail. The driver raised it as **PLAN REVIEW
REQUIRED** (`RAISE-A0-c1.json`): _"SUSPECT THE CRITERION, NOT THE MODEL — an AC that no implementation can
satisfy fails identically at every tier."_

Two real defects:
1. **AC drift:** A0's `acs`=A5. A5 (og-req) = *post-teardown app boots + suites green* — a **product** state.
   A0 authors **no product code** (it builds the fence harness), so A5 is structurally unsatisfiable by A0.
   A5 is proven by B8/F-OVM, not A0.
2. **INTERCEPTION_GAP:** the harness `FENCE_STUB` does not actually replace the constituent to force a
   named-red — a genuine harness gap (this is codex55's rev1 MED #5 resurfacing: A0 was too big / under-gated).

## Ruling (north, standing approval — a plan defect is a north interrupt)
Directed projcore (do NOT retry A0 as-is):
1. **Repair A0's gate to HARNESS-CORRECTNESS only** — the `--harness-smoke` passing (real fence path red on
   HEAD by a NAMED assert, `FENCE_STUB=B2` red on named A2, isolated DB teardown + `reclaimed_bytes`). Remove
   A5 from A0's acs; A5 stays owned by B8.
2. **Fix the FENCE_STUB interception** in the harness so a stubbed constituent forces a named red.
3. **Recover, don't rebuild:** the A0 work is preserved (`git cherry-pick 7d0a47580252..refs/tiller/command-center-2026-08-26/A0`, 9 files, 583 insertions). Re-gate it correctly.
4. **Decompose if still too big for glimmer:** A0a = runner + cc-run-isolated + harness-smoke + OVM journey
   spec; A0b = the other four journey specs.
5. Re-mark PLAN-READY → north re-reviews + re-approves → tiller re-drains.

## No live-app exposure
Nothing deployed. Tiller is dry-run only; the stall happened entirely on temp copies / harness authoring. The
live `data/agjassist.db` and pm2 were never touched. The A0 durable ref is safe (gc cannot collect it).
