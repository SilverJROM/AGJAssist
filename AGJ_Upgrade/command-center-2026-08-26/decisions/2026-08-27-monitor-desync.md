# 2026-08-27 monitoring desync (north asked; driver not restarted)

North: queue showed 5 DONE, tiller.pid 2805424, heartbeat STALLED. Work was fine. Do not kill 1201168.

## Verified

- Live: monitor `1201147`, driver `1201168` (F3). `2805424` already dead. Lock holders = those two pids.
- `tiller.pid` already `1201147` (written 12:38Z).
- `queue.md` already 18 DONE / 21 PENDING from advance markers (A0, B1–B8, H8, C1–C5, F0–F2). `atomic_advance` rewrites one PENDING row on disk, so this survives F3's next advance.
- Heartbeat `done=5` came from truncated `driver.log` (park rollback): only A0,B1,B2,B5,B6 had `[VERDICT-V1] verdict=PASS`. tiller_status counts PASS ∩ plan, not queue checkboxes.
- HEAD at reconcile: `e00ed40` (F3 a3 specimen). Telemetry: F3 a4 `impl_sol` brief_sent. North's `e3afd7b` was a2.

## Done this turn (no driver restart)

1. Left queue.md at 18 DONE (already correct).
2. Left tiller.pid at 1201147. Nothing to reap for 2805424.
3. Appended 13 reconcile PASS lines to `dispatch/driver.log` from `advance-*.marker` (B3,B4,B7,B8,H8,C1–C5,F0–F2). Did not mark F3 PASS. Append-only so the live F3 writes are not clobbered.
4. `tiller_status.compose` + `persist`: **NOMINAL, done=18, pending=21, total=39, driver_pid=1201147**.

Plan has 39 rows (C0/H8/F0 injected), not 38.
