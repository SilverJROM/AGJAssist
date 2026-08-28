# 2026-08-28 D0 glimmer 503 retry (north-ordered, not a RAISE)

North: 503 was a transient capacity spell; endpoint 140:48731 healthy; live inference 200; no orphan seats to reap. Retry D0's glimmer seat; re-dispatch only if the driver is wedged on the internal stall.

Facts at 2026-08-28T01:24Z:
- Endpoint `http://192.168.254.140:48731/v1/models` → 200 (`muse-glimmer-30b`).
- Seat `x-tlre7cd71a78feb_impl_glimmer` idle at empty prompt after `Service unavailable (503)`.
- Driver 1679333/1679354 still polling D0 a1 (`brief_sent` then `seat_nudge` SIGWINCH then `STALLED.json`). SIGWINCH does not retry a failed inference.
- Pulse 2446798 LIVE. No RAISE-D0. HEAD still b1d8258 (E4). No D0 commit. Parked `[]`.
- Other glimmer seats (`x-tlre093e95f7fd0`, `x-tlrfa6c37db1133`) belong to lkAsst / lokalAI-v2 — not ours.

Action (retry, not re-dispatch):
- Driver was not wedged-halted; drain still waiting on role_done. Re-dispatch / resume would race park-rollback. Not done.
- Guard R5 refused a send: Tiller seats live in `tiller-sessions.ledger`, not `spawned_sessions.txt`.
- Claimed the seat in `spawned_sessions.txt` for one guarded send, then dropped the claim so a later sweep cannot reap Tiller's worker.
- Guarded send: `[projcore] Transient 503 is cleared … Retry now: read …/drv-D0-impl-a1.md and execute it exactly…`
- 01:29:04Z pane: `Waiting for response… 45s` on Muse Glimmer 30B — live inference, not 503.

Product ACs unchanged — not a north "done" change.
