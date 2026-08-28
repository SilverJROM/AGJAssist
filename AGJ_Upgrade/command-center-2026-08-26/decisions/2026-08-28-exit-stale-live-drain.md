# 2026-08-28 TILLER-EXIT ping — STALE vs live drain

Ping: driver EXIT (terminal_drain=False) at ~07:29Z.

## Snapshot 2026-08-28T07:30:49Z

- `dispatch/TILLER-EXIT.json`: **absent** (already consumed).
- Monitor **143379** live (pidfile matches /proc, elapsed ~3m).
- Driver **143400** live (`projcore-driver.py drive` this run).
- parked: **[]** (no parked dir).
- Product porcelain: **clean**.
- HEAD: `23ff1d1` feat(F4): complete one-row header and validator criteria.
- Queue: 32 DONE / 9 PENDING (D7 E5 F4 F5 F6 F7 G1 G2 D0).
- No advance-F4 / advance-E5.

## What the EXIT was

`tiller.log`: monitor **end rc=0 at 07:25:33Z** — F4 pre-dispatch TRACKED PRODUCT dirt (`header.spec.ts`, `app.js`, `style.css`). Tree-level STOP, nothing parked. That stop was already handled:

- Dirt landed as `9919e9e` + `72ec833` (+ `23ff1d1` F4 follow-up).
- DIRECTION-F4-a9 SKIP applied 07:27:37Z (F4 was not parked).
- DIRECTION-E5-a11 PLAN_SOUND applied 07:27:37Z, unparked.
- Resume already running: monitor start **07:27:33Z**.

## Live drain (do not second-resume)

After resume: E5 PLAN_SOUND accepted → CLOSE red → opus5 LOCALIZE → `fault_class=implementation failing_units=E3` → **F4 a1** glimmer `x-tlre7cd71a78feb_impl_glimmer` (created 07:29:57Z, base_head `23ff1d1`). STATUS 07:29 still said E5 brief_sent (cadence lag).

## Decision (local, not north)

- **No `tiller resume`.** Second writer while 143379 holds the drain.
- **No RETRY/SKIP/STOP.** Escalations for this stop already applied.
- **No north.** Does not change what "done" means (not plan fault, not AC ambiguity, not og contradiction, not scope, not 3 failed repair rounds). F4 dirt was tree hygiene; E5 PLAN_SOUND already north-owned and applied.
- Observation only: after E5 localize named E3 (already DONE), drain proceeded to F4 a1. Standing `directions-active/E5.txt` still carries the fence-author named-red rewrite; it rides the next E5 PREPARE. Do not interrupt F4 a1.

Stand down until next RAISE / STATUS? / real EXIT.
