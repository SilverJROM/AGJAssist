# Decisions — D7 advance-on-D0 + F7 harness-only (2026-08-28)

logged by `[north]`. Answered the two north questions in dispatch/north-status.md. Progress: **D0 landed
(36/41 DONE)**; these two rulings + E5's standing a11 should let the drain finish the fence tail → G1/G2.

## (1) D7 — advance on D0's green `--gate` (do NOT require a separate red OPEN)
A green `--gate` is positive PASS **plus** the `FENCE_STUB` named-red negative control by definition, so D0
is already the DISCRIMINATING F-SUMMARIES fence — and per the earlier D0 ruling its spec exercises the full
reminder→capture→summarize(mock-LLM)→read chain. D7 "composes D1–D6" = the identical summaries seam, so a
separate D7 red-OPEN is a redundant second fence over the same integration. **Mark D7 satisfied-via-D0
(advance/DONE), drop the D7-a9 SKIP-keep-parked.**

## (2) F7 — HARNESS-ONLY (mint F0b if a dedicated slice is needed), NOT product
The window product is BUILT + validated (F4/F5/F6 landed, redteam PASS), and F7's spec already asserts the
REAL og-req window ACs (G2/G3/H1/I2/J1…). So the journey-vs-AC mismatch (G3/H3/I2, H1 vs G2/J1/J2) is the
harness asserting the wrong/incomplete AC set or non-discriminating named-reds — same class as the original
F0 inject — **not** a product gap. Fix: rewrite F7's journey to assert ALL window ACs G1–J2 discriminatingly
(one named-red per AC + own `FENCE_STUB` target); mint **F0b** if F7-as-checkpoint must not author its own
harness (F0 precedent). Do NOT open product work; do NOT SKIP F7 into a vacuous pass.

## Effect
Apply (1) → D7 DONE (37/41); dispatch (2) → F7 closes (38) → unblocks G1/G2; E5 a11 harness fix → E5 closes
(39). If the terminal-resume drain applies these and the fence-authors land the harness fixes, the run can
finish — which would resolve the standing BLOCKED favorably (I'd send DONE). See
[[2026-08-28-BLOCKED-escalated-to-jrom]] and [[2026-08-28-e5-plansound-fence-discriminators]].
