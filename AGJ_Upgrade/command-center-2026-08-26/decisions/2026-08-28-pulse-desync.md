# 2026-08-28 pulse STALLED / park-rollback desync

Watcher: solicit pulse alive but last tick 1530m; 31 queue rows not DONE; re-arm north-pulse. Do not resume.

## Verified
- Pulse process `2446798` was never dead. Park-rollback restored `north-pulse.heartbeat` to 2026-08-27T03:28:57Z and replaced `north-pulse.log` (process still holds the deleted inode). Next 300s tick rewrote a live heartbeat. `tiller north-pulse start` → already live (exit 3). Not killed.
- Live driver is still `1679333`/`1679354`. `tiller.pid` had been restored to dead `2805424`. Rewrote pid to `1679333`. `tiller resume` not run.
- `queue.md`/`plan.md` rolled back to the committed 36-row / 5-DONE snapshot (lost H8,C0,D0,E0,F0). Restored 41 rows from `advance-*.marker` + harness injects. `verify-queue` OK (32 DONE / 9 PENDING).
- Truncated `driver.log` made `tiller_status` count 5 PASS. Appended 27 reconcile PASS lines from markers (same 2026-08-27 playbook). STATUS now NOMINAL 32/41, driver pid-file verified.
- DIRECTION-D0-a4 already applied/unparked 04:56:36Z. parked=[]. Drain on D0. HEAD still `b1d8258` (park rollback); E0 marker `88d1760` exists off-HEAD.

No product AC change — not north.
