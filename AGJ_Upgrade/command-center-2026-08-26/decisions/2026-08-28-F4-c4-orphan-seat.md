# 2026-08-28 RAISE-F4-c4 — orphan validator seat

`spawn_seat refused: x-tlre7cd71a78feb_validator_opus5 exists but is NOT in this run ledger`.

F4 a1 impl had committed `a62de6d` (spec one-row + menu close). Validator spawn failed. Park rolled HEAD to `23ff1d1`; ref `refs/tiller/command-center-2026-08-26/F4` holds `a62de6d`. Stale DIRECTION-F4-a2 RETRY (old PLAN_SOUND) then unparked and restarted F4 a1 glimmer.

The opus5 session was **this-run prefix**, created 06:17, idle DONE (validated `23ff1d1`). Lost from tiller-sessions.ledger on park-rollback. Same class: idle `impl_sol` from 07:17.

## Decision (local)

- Reaped both via `projcore-kill-session.sh` (temporary spawned_sessions.txt membership for the guard, then dropped). Live F4 a1 glimmer kept.
- DIRECTION-F4-a11 SKIP_TO_PROJCORE — ACK c4. F4 is not parked; a1 is in flight.
- **Not RETRY** — a2 already unparked; RETRY only acts on a parked row.
- **Not north** — infrastructure, does not change "done".

Next F4 validator spawn can create a fresh `validator_opus5`. If this a1 parks, cherry-pick `a62de6d`.
