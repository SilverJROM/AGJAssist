# 2026-08-28 BACKSTOP #1 stale — live drain, no resume

Watcher nag: driver EXITED with 6 pending. Facts at 2026-08-28T10:07:33Z:

- No `TILLER-EXIT.json`
- Monitor 1125947 / driver 1125968 live since 10:05:45Z (pidfile matches /proc, lock held)
- STATUS 10:07 NOMINAL, D0 a1 glimmer `brief_sent`, seat `x-tlre7cd71a78feb_impl_glimmer` live
- parked=[D7, E5, F7]; D0 not parked
- Pulse 2446798 live `--north agj-3767`

The nag is the 09:52/09:55 terminal_drain (watch BACKSTOP nag 1 at 09:53, nag 2 after resume). Do not launch a second driver.

F7-c2 already SKIP a9/a10. Not north.
