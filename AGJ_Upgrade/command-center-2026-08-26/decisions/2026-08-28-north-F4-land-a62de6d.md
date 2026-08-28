# 2026-08-28 north F4: land validated-good form, do not re-drive drift

North: F4 is not a product defect. `validation/F4-redteam-v4.md` PASS standard-clean at `23ff1d1`. Drift is post-validation re-edit of `header.spec.ts` (second `[data-testid=terminal-menu]` click vs overlay). Recommendation: cherry-pick/accept `refs/tiller/.../F4` = `a62de6d` and mark DONE.

## Applied (local gate, not a new north question)

- Cherry-picked a62de6d onto HEAD as `c62553e` (spec only: overlay `pointerdown`, height <= 60).
- Replaced `directions-active/F4.txt`: no chrome re-drive; pin overlay close; forbid second gear click.
- Rewrote the in-flight `drv-F4-impl-a1.md` DIRECTION header to match (glimmer already thinking on the old brief — next attempt is pinned).
- Did not kill the live glimmer (381861 F4 a1). Did not fake `advance-F4.marker` (tiller advances on validator PASS).

If this a1 re-introduces the broken spec edit, the standing brief forbids it on the next attempt. Fence tail after F4: E5 named-reds (a11), D0/D7, F5-F7.
