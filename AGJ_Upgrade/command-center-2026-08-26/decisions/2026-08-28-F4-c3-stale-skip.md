# 2026-08-28 RAISE-F4-c3 — SKIP (stale tree dirt)

RAISE-F4-c3.json: pre-dispatch TRACKED PRODUCT dirt, raised 07:25:32Z, epoch **111833 (dead)**.

Dirt already committed (`9919e9e`, `72ec833`, `23ff1d1`). DIRECTION-F4-a9 SKIP already applied 07:27:37Z. Product porcelain clean. F4 is **not parked**. Live drain: F4 a1 glimmer on 143379/143400 (STATUS 07:34 brief_sent).

## Decision (local)

- DIRECTION-F4-a10 SKIP_TO_PROJCORE — ACK the re-ping only.
- **Not RETRY** — F4 is not parked; RETRY would not apply and would not steer the in-flight a1. Standing PLAN_SOUND is in `directions-active/F4.txt`.
- **Not STOP.** Not north (tree hygiene, already fixed; does not change "done").

F4 a1 continues.
