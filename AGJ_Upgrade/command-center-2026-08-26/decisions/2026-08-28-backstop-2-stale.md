# 2026-08-28 BACKSTOP #2 — STALE vs live drain

Ping: driver EXITED, 9 slices not DONE, no live driver, `tiller resume`.

## Snapshot 2026-08-28T07:35:08Z

- `TILLER-EXIT.json`: **absent**
- Monitor **143379** live (pidfile matches /proc, elapsed ~7m, started 07:27:33Z)
- Driver **143400** live (`projcore-driver.py drive` this run)
- STATUS 07:35 **NOMINAL** — now F4 a1 glimmer (`x-tlre7cd71a78feb_impl_glimmer`), quiet 4m
- parked: **[]**
- Queue 32/41 DONE, 9 PENDING (expected; drain in flight)
- Pulse LIVE (pid 2446798, hb 07:33:31Z)

The 07:25:33Z monitor-end (F4 tree dirt) is still in `tiller.log`. Resume already happened. Backstop is reading that corpse.

## RAISES

All 17 RAISE files have a later DIRECTION ACK. Latest:

- F4-c3 → a9 (applied) + a10 SKIP (07:34)
- E5-c4/c5 → a12/a13 SKIP (07:33); PLAN_SOUND a11 stands
- No unanswered RAISE. No new DIRECTION this ping.

## Decision (local, not north)

- **No `tiller resume`.** Second writer while 143379/143400 hold the drain. Also in-flight F4 a1 may dirty `src/web/public/app.js`; a resume would STOP on tracked product dirt.
- **No north.** Does not change "done". Not stalled.

Stand down until next RAISE / STATUS? / real EXIT with a payload file and dead pid.
