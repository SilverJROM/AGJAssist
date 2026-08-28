# 2026-08-27 B8 c1 re-delivery — SKIP (already DONE)

Watcher re-delivered `RAISE-B8-c1.json` at ~12:41Z (`why`: integration green but OPEN id B2 still failing). That RAISE is from **04:57:30Z**, epoch `1787798898-2805445` (old pid 2805445). Current driver is `1201147` / python `1201168`.

## Evidence (this turn)

- `queue.md`: B8 `[DONE]` with advance marker `78fe35e10e`
- `dispatch/advance-B8.marker`: `{"slice":"B8","verdict_sha":"78fe35e10ee05ad7bdae57c5e881d30bb2c02a0b"}`
- `dispatch/fence-close.B8.json`: `green=true`, `passed_ids` includes **B2**, `failed_ids=[]`, `negative_control_ok=true` (named A2 red), `measured_at_head=78fe35e10e`
- `dispatch/fence-state.B8.json`: `last_green=true`
- `dispatch/parked-slices.json`: `[]`
- `DIRECTION-B8-a0.json`: `applied=true`, `outcome=unparked`, `applied_at=2026-08-27T05:10:16Z`
- `DIRECTION-B8-a1.json`: north retarget note (H8 harness); B8 subsequently advanced

The original B2 miss was a **harness/composition** fault (`fault_class=implementation`), repaired by H8 + CLOSE. It does not change what "done" means. Not 3 failed repair rounds on an open slice.

## Action

`SKIP_TO_PROJCORE` as `DIRECTION-B8-a2.json` — claim the stale re-delivery, do **not** `RETRY_WITH_DIRECTION` (would only matter if B8 were parked; it is not, and retrying a closed fence is a category error). Not `STOP_TRUE_BLOCKED`. Not north.

Live drain: F3 a2 FAIL `TEST_NOT_DISCRIMINATING` I2 → driver already RE_DISPATCH a3 (budget 2/6, glimmer). No RAISE. Do not interfere.
