# 2026-08-28 D0 not a D7 fence contributor (driver invariant)

EXIT 2026-08-28T09:55:16Z `terminal_drain=true` after DIRECTION-D0-a10 RETRY unparked D0.

Driver then: `blocked: fence D7 is parked without an OPEN baseline` and re-parked D0. `select_next` → NONE_DISPATCHABLE. parked=[D0, D7, E5, F7].

## Mechanism

`fences_for()` treats every INTEGRATION dep as a contributor. D7 deps included D0, so dispatching D0 required `ensure_fence_open(D7)`. D7 is parked (OPEN vacuous after PREPARE 12b6391; marker retired to `fence-open.D7.marker.pre-reprepare`). A parked fence blocks its contributors even if an OPEN marker existed.

OPEN on current HEAD is vacuous because D1–D6 already landed. Restoring the stale marker fails `baseline_describes_reality` (hash 0e3d5df3 vs current summaries-fence 043d7f18). Fabricating OPEN is forbidden. RETRY on INTEGRATION D7 is a category error (unpark → re-CLOSE/OPEN → re-park).

## Local fix (does not change "done")

- `fence-contract.json` D7 `contributors` were already D1–D6 (D0 never a product unit).
- plan.md D7 deps: drop D0. Sequencing stays coordinator-enforced: D7 remains in `parked-slices.json` until `advance-D0.marker`.
- D0.txt: do **not** wholesale cherry-pick `8a0ebc5` (side-branch from b1d8258/E4; would revert F4–F6 and clobber wakeup/window fences). Port only the summaries-fence journey + `validation/D0-fix-a3.md` onto HEAD `241b5cf`. Keep `scripts/cc-capture-reply.mts` (d643c37).

## Not this turn

- **F7:** still `fault_class=plan`. SKIP a9 stands. North question unchanged (harness-only vs mint F0b vs product).
- **E5:** PLAN_SOUND a11 stands. Unparking now would `_fence_step` CLOSE on the colliding named-reds (fp1:4c534f69) and same-seam/exhaust immediately. Needs a harness rewrite before CLOSE; not an L2/L3 retry. Not north (already ruled).
