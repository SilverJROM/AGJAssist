# 2026-08-28 D7 — OPEN unsatisfiable after D0 PASS (escalate north)

EXIT 2026-08-28T10:21:02Z terminal_drain. D0 a2 glimmer PASS `7a4c7c0`. Queue 36/41. parked=[D7, E5, F7]. pending=5 (D7 E5 F7 G1 G2).

## D0 proof (same command as D7)

Plan tests for D0 and D7 are identical: `FENCE_ID=D7 … --gate`.

- Positive (`validation/D0-gate-pos-validator-a2.json`): collected E1,E2,E3,F1,F2,F3; passed all six; failed [].
- Negative (`validation/D0-gate-neg-validator-a2.json`): FENCE_STUB=D3 named-red E1 kind=assert (500 vs 200).
- Verdict PASS req=HARNESS-SMOKE. Product D1–D6 unchanged.

## Why D7 cannot dispatch

No `fence-open.D7.marker` (only `.pre-reprepare`, hash mismatch vs current summaries-fence `99db3278…`). `_fence_step` on an unparked D7 runs OPEN first. A fully green positive run is not a valid OPEN (`nothing failed — the behaviour already exists`). That is D7-c2 again, now on the D0 journey, because D1–D6 already landed.

RETRY on INTEGRATION is a category error. PLAN_SOUND unpark → OPEN vacuous → re-park. Fabricating an OPEN marker is refused.

E5 stays parked (named-red collision; CLOSE would same-seam). F7 stays parked (plan-class; SKIP a10 applied).

## North question (changes the proof of D7 "done")

1. **Treat D0's `--gate` as D7 CLOSE** and allow D7 to advance without a post-hoc OPEN (ACs unchanged; proof path is the engine exception).
2. **Require a red OPEN anyway** (would need a product break or a fake baseline — projcore will not forge).

Projcore default if silent: (1) — D7 ACs already measured; do not OPEN-vacuous loop. Waiting for the ruling before writing an advance marker.
