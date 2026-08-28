# 2026-08-27 F3 c1 re-delivery — SKIP (in-flight a3)

Watcher re-delivered `RAISE-F3-c1.json` (TOP RUNG, `IMPL_INCOMPLETE|I1,I2`). That RAISE is from **09:56:46Z**, epoch `3745902`.

## Already done

- North PLAN_SOUND: I1/I2 still satisfiable
- `DIRECTION-F3-a0` RETRY applied 10:00Z (unparked), budget 6
- Current driver `1201168` is on F3 a3: impl `e00ed40`, validator opus5 in-flight
- No `advance-F3.marker`; queue F3 PENDING; parked `[]`

## Why not RETRY / STOP / north

RETRY would unpark if the slice parks and race the live a3. STOP kills the drain. North already ruled PLAN_SOUND on this exact RAISE; product I1/I2 unchanged. 3 failed rounds were the 09:56 signal — already answered, remainder is executing.

## Action

`SKIP_TO_PROJCORE` as `DIRECTION-F3-a2.json` — claim the stale file only. Let a3 finish.
