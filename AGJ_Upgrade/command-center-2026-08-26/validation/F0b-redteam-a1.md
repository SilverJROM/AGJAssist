F0b validator red-team a1

commit under test: 54e06c7f04251383856ece7482d42af718b1f033
focused command: FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate

Result: FAIL

Lens 1 - assertion execution
The harness does not execute the assertion callback in `check()`. Lines 68-85 only inspect
synthetic env flags and then add the id to `localPassed`. A broken G1-J2 UI can still pass
the positive leg because the locators/actions inside the callback are dead code.

Lens 2 - requirement coverage
Several callback bodies still do not encode the requirement even if `check()` were restored:
G2 never sends and verifies draft clear/indicator, G3 never reloads and reads the restored
per-pane draft value, H2 never checks the collapsed one-row bell state, H3 only checks body
visibility instead of theme readability at required widths, and J2 never drags the scrubber
or proves it uses the same switch action.

Lens 3 - negative control specificity
`FENCE_STUB=F1` is handled inside the test helper by appending an I1 failure. That is not a
server-backed contributor negative. It does not perturb the refresh endpoint, tmux transcript,
or any public path that I1 actually asserts.

Lens 4 - focused command
The focused gate exits 0 and produces `.fence-gate-pos.json`, `.fence-gate-neg.json`, and
`fence-report-v1.json`. This is expected from the current synthetic red path, but it is not a
clean PASS because the gate can pass without discriminating the G1-J2 behaviours.
