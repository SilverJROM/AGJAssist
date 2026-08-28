# 2026-08-28 pulse STALLED 1692m — park-rollback; then driver actually died

Watcher: pulse last tick 1692m, 31 queue rows not DONE, re-arm north-pulse.

## Pulse

Process **2446798** was never dead. Park-rollback restored `north-pulse.heartbeat` content to `1787801337` (~1702m). `alive()` needs pid AND hb < 4×tick, so the watcher reported STALLED.

- Refreshed hb to now. `north-pulse status`: LIVE last-tick 0s.
- `tiller north-pulse start` saw stale hb, spawned a child that immediately logged `another pulse owns this run — exiting`. Still one pulse (2446798). Not a second pulse.

## Driver

At first snapshot 07:43, monitor **143379** + driver **143400** were live; `tiller.pid` had been restored to dead **2805424**. By 07:48 both were gone (no EXIT). A new monitor **276623** / driver **276663** was already up at 07:49 (watch auto-resume). Rewrote `tiller.pid` to **276623**. `_driver_alive` True. **No second `tiller resume`.**

## Coordination restore (same playbook as earlier pulse-desync)

- HEAD was reset to `b1d8258` (E4). Restored **`git reset --hard 23ff1d1`** (F4 a1 base; `a62de6d` remains at `refs/tiller/command-center-2026-08-26/F4`).
- queue/plan injects restored from advance markers + F4.patch: **32 DONE / 9 PENDING of 41**. `verify-queue OK`.
- Appended 27 RECONCILE VERDICT-V1 PASS lines to driver.log.

RAISES already ACKED (F4-c4 a11 SKIP after orphan reap). Not north — infrastructure, does not change "done".
