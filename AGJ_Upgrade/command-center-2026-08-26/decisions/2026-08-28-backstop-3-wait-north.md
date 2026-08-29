# 2026-08-28 BACKSTOP #3 — same 10:21 EXIT, waiting north, no resume

Watch nag 3: 5 pending, no live driver. TILLER-EXIT still `ended_at=2026-08-28T10:21:02Z`. No new RAISE. HEAD `7a4c7c0`. parked=[D7,E5,F7].

Already decided this EXIT: D0 DONE; D7 SKIP a9 (OPEN would be vacuous); E5/F7 stay parked. North owns D7 proof-path + F7 plan-class. Resume would APPLY D7-a9 then immediately NONE_DISPATCHABLE and re-EXIT. No resume until north rules or a dispatchable row exists.
