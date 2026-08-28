# 2026-08-27 C6 c1 re-delivery — SKIP (wait for C0)

Watcher re-delivered `RAISE-C6-c1.json` (`fault_class=plan`: journey invented `/schema` `/due` `/fired`). That RAISE is from **08:02:10Z**, epoch `3745902`.

## Already done

- `DIRECTION-C6-a0` SKIP applied 08:15Z (do not walk L2/L3)
- C0 harness row injected; C6 deps = `C1,C2,C3,C4,C5,C0`
- `DIRECTION-C6-a1` RETRY applied 10:00Z (unparked so CLOSE can run *after* C0)
- queue: C0 PENDING, C6 PENDING
- `fence-state.C6.json`: `last_green=false` (pre-C0 fingerprint)
- parked `[]`

## Why not RETRY now

RAISE note forbids RETRY into L2/L3 on `fault_class=plan`. C0 has not landed. Re-unparking C6 would re-run CLOSE against the same broken journey.

## Why not north

Product ACs C1–C6 unchanged. Plan repair (C0) is already in the queue. This re-delivery does not change what "done" means.

## Action

`SKIP_TO_PROJCORE` as `DIRECTION-C6-a2.json` — claim only. C6 stays pending until C0 DONE, then the driver CLOSE path from a1 is the intended resume.
