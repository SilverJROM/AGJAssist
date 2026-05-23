# Validation — O8 (OU7) — PASS (iter1)
- Data-driven (98-sample study): activity = body-change + active-turn, ignore chrome. extractBody strips chrome/composer/status/spinner/timer; hashPane=hash(extractBody); hasActiveTurn = "esc to interrupt" on a spinner line (NOT the status bar — iter1 fix). WORKING = active-turn OR body-changed. Zero LLM in tick loop.
- 27 classifier tests. LIVE: HRIS (idle, empty composer) was falsely "working" pre-fix → now "waiting_human" (correct). hasActiveTurn no longer trips on bar-hint (verified). lkcamp confounded by JROM live-typing in its composer (correctly reads active).
- OU7 VERIFIED. projcore-watcher.sh has the change-required fix (O6-era); body-strip refinement can mirror O8 if needed.
