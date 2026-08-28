# 2026-08-28 RAISE-E5-c4 — SKIP (stale same-seam)

RAISE-E5-c4.json: same seam `fp1:4c534f69e7dd8f2fd157`, fault_class=plan, raised 07:25:32Z, epoch **111833 (dead)**.

Not a new composition defect. DIRECTION-E5-a11 PLAN_SOUND already applied 07:27:37Z (north harness named-reds). Standing `directions-active/E5.txt`. E5 is **not parked**. Live drain is F4 a1 glimmer on 143379/143400.

## Decision (local)

- DIRECTION-E5-a12 SKIP_TO_PROJCORE — ACK c4 only. Does not park.
- DIRECTION-E5-a13 SKIP_TO_PROJCORE — ACK live-epoch RAISE-E5-c5 (07:29:57Z, same fingerprint after localize of old journeys). Same SKIP; last-writer wins, both ACK.
- **Not RETRY** — would walk L2/L3 on a plan-class seam; E5 not parked so RETRY would not apply anyway.
- **Not second PLAN_SOUND** — a11 already counted as a repair round; fence-author PREPARE has not run yet; another PLAN_SOUND would interrupt F4.
- **Not north** — does not change "done". Same fingerprint already ruled. Not 3 failed rounds on the new brief.

F4 a1 continues. Next E5 PREPARE carries the standing named-red rewrite.
