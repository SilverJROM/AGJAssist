F0c validator red-team a1

commit under test: 2f3bccec3351c4fb9530ecd9058b7ac8f3a7bbc2
focused command: timeout --signal=TERM --kill-after=15s 180s FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate

Result: FAIL

Lens 1 - exact commit and scope
FAIL. The exact commit changes only `fence-contract.json`, replacing `expected_negative_fail_ids` from `G3` to `I1`. F0c scope also required one named-red per G1-J2 via `FENCE_STUB=<AC>` and a remapped negative control command; neither appears in the commit diff.

Lens 2 - focused gate execution
FAIL. The required gate exited 1. The positive run passed all ten G1-J2 ids. The negative run also passed all ten G1-J2 ids, so the runner wrote `fence=F7 verdict=FAIL fault_class=implementation`.

Lens 3 - I1 negative-control mechanism
FAIL. `fence-contract.json` still runs the negative control with `FENCE_STUB=F1`, while the expected negative failure is `I1`. The only F1 server hook intercepts `/api/agent-session/refresh`; the actual I1 refresh button calls `/api/tmux/panes/:target/output?...&refresh=1`, so the configured stub never perturbs I1.

Lens 4 - per-AC named-red coverage
FAIL. `e2e/command-center-window-fence.spec.ts` never reads `process.env.FENCE_STUB`, and there are no G1, G2, G3, H1, H2, H3, I1, I2, J1, or J2 named stub branches in that spec. The current harness cannot prove each acceptance id has a discriminating public-path negative.

Lens 5 - report emission and evidence files
PASS. The gate wrote `fence-report-v1.json`, `.fence-gate-pos.json`, and `.fence-gate-neg.json`; copies were preserved under `validation/`. The report collects all G1-J2 ids.

Note: HARNESS-SMOKE has no standalone og-requirements text; this verdict treats the F0c scope text and plan row as the authority.
