# SUPERSEDED — F4 PASSED at commit 23ff1d1b3c304afbaa5315af2719760ac5c0ae30.
#
# This file was drafted against an earlier, uncommitted working-tree state that no longer
# exists (see validation/F4-redteam-v4.md, Lens 0, for the tree-churn timeline). The slice
# then landed 9919e9e -> 72ec833 -> 23ff1d1 and passed validation with 11 of 11 behavioural
# mutations caught. There is no outstanding prescription for F4.
#
# The only non-blocking note carried forward: e2e/command-center-header.spec.ts asserts
# topbar height <= 48 against a measured 47.19 — a ~0.8px margin. Widen that literal to 52
# the next time the spec is touched.
