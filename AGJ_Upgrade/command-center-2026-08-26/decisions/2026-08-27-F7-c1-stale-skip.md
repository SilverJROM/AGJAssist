# 2026-08-27 F7 c1 re-delivery — SKIP (wait for F3–F6)

Watcher re-delivered `RAISE-F7-c1.json` (OPEN refused: nothing failed). That RAISE is from **04:57:31Z**, epoch `2805445`.

## Already done

- `DIRECTION-F7-a0` SKIP applied 05:10Z (vacuous OPEN, keep parked)
- North: G3 is `[data-testid=refresh-from-session]`, not GET `/api/agent-session/refresh` 200; F0 authors named-red
- `DIRECTION-F7-a1` RETRY applied 05:25Z (unparked so CLOSE can run after F0–F6)
- F0 DONE `d08ca352dd`; F1 F2 DONE; F7 PENDING deps `F0,F1,F2,F3,F4,F5,F6`
- parked `[]`

## Why not RETRY now

RAISE note forbids RETRY into L2/L3 on `fault_class=plan`. F3–F6 have not landed. Re-OPENing F7 would either be vacuous or CLOSE an incomplete window.

## Why not north

Product G1–J2 unchanged. F0 already in queue and DONE. This re-delivery does not change what "done" means.

## Action

`SKIP_TO_PROJCORE` as `DIRECTION-F7-a2.json` — claim only. F7 stays pending until F3–F6 DONE.
