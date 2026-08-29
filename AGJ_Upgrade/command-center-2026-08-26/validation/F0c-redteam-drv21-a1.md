F0c validator red-team pass, attempt 1, marker DRV-F0c-21.

Commit under test: 6c7a2e61f70009834d7e3b280a5fa00c43ffb5df.
Scope authority: HARNESS-SMOKE has no criterion text; judged against F0c scope in plan.md.
Mechanism chosen by the harness: page/public-path FENCE_STUB=<AC> perturbations for G1-J2,
with the --gate negative control remapped to server-backed I1 pane-output refresh.

Lens 1 - exact commit/diff: PASS. `git show 6c7a2e61f70009834d7e3b280a5fa00c43ffb5df`
identifies the F0c commit and `git diff 6c7a2e61f70009834d7e3b280a5fa00c43ffb5df^..6c7a2e61f70009834d7e3b280a5fa00c43ffb5df`
is empty. The committed harness state nevertheless contains the required F0c contract/spec behavior.

Lens 2 - fence-contract mapping: PASS. F7 collects G1,G2,G3,H1,H2,H3,I1,I2,J1,J2.
Its negative_control_cmd is `FENCE_STUB=I1 ... --gate`, expected_negative_fail_ids is
only I1, and expected_negative_kind is assert.

Lens 3 - named-red mechanism: PASS. `e2e/command-center-window-fence.spec.ts`
uses literal FENCE_STUB ids G1,G2,G3,H1,H2,H3,I1,I2,J1,J2. I1 is not a
throw-in-check; it routes the browser refresh request for `/api/tmux/panes/*/output?refresh`.
The other ids perturb visible public DOM/localStorage/theme paths before assertions run.

Lens 4 - positive and negative discrimination: PASS. The focused gate exited 0.
Fresh positive report passed all ten ids with no failures. Fresh negative report failed
exactly one named assertion: I1.

Lens 5 - report/evidence emission: PASS. `fence-report-v1.json` was written by the
runner after the gate and copied to validation, along with the positive and negative
gate reports and the focused log. All referenced files exist on disk.
