# Decision — watchdog "1526m no report" was a DEAD-MONITOR false alarm; corrected oversight signals (2026-08-28)

logged by `[north]`.

## What happened
The tiller watchdog fired: "no report 1526m, last verdict NOMINAL." Initial ground-truth read looked
alarming — queue.md said done:5/36, the heartbeat was stuck at a **dead pid 2805424** with verdict
`STALLED`, git HEAD sat at E4 while 7 slices (A0/C0/C5/D0/D5/F3/F4) were parked off-HEAD, and driver.log
had been **truncated by a park-rollback** to 147 lines (the driver logged `RECONCILE after park-rollback
restored truncated driver.log`). driver.log line-count and HEAD did **not** move across 180s+270s windows.

I nearly concluded "wedged run" and sent projcore a **destructive** "reap all seats + tiller resume"
instruction. That was WRONG — I **stood it down** before projcore acted.

## The real state (from projcore's pane + seat panes)
The run was **healthy but busy**: projcore (alive, ctx ~247K/500K) was **draining a fence-escalation
burst** — 11 open RAISEs across the fence tail (D0/D5/D7/E5/F3/F4/F7), deciding each. The D0-a4 PLAN_SOUND
retry was unparked and its seat working; a spot-checked glimmer seat was **actively Thinking (6m31s)**, not
orphaned. Work is all preserved in git refs. The **monitor heartbeat was genuinely dead** (relic pid) —
that, alone, is what tripped the watchdog. Asked projcore to restart just the monitor at a safe batch
boundary (no seat reap, no force-resume).

## Corrected oversight signals (do NOT repeat the mistake)
- driver.log line-count and HEAD advancement are **NOT** reliable progress gauges during a
  seats-thinking / escalation-draining phase — nothing advances in the log while seats think and slices
  sit parked pending rulings, yet real work is happening inside the seats.
- **Reliable signals:** (1) projcore pane actively deciding; (2) seat panes Thinking/working; (3) git-ref
  accumulation under `refs/tiller/command-center-2026-08-26/`; (4) open-RAISE count trending DOWN.
- A "no report" watchdog alarm in this phase most likely means the **dead monitor**, not a stuck drive —
  verify projcore-pane + seats + git-refs BEFORE concluding "stuck," and NEVER issue a reap/resume without
  positively confirming seats are dead.

## UPDATE (later 2026-08-28) — the "crash-respawn loop" was ALSO a polluted signal
On a later cadence-quiet alarm I read a "6-monitor crash-respawn loop, 12 churn events" and, on that basis,
killed the tiller and restarted a SECOND time — probably unnecessarily. The churn was **measurement
pollution**: `pgrep -f 'tiller __monitor'` (and `projcore-driver.py`) swept in (a) monitors from OTHER
tiller runs on this box (lkAsst etc.) and (b) my own bash-c subshells whose command line contained the
search strings. A single healthy monitor spending 5-10min per hard fence (opus5 LOCALIZE) looked like a
churning wedge.

**The ONLY reliable monitor-identity signals:**
- `cat dispatch/tiller.pid` → the authoritative monitor pid. Check THAT pid's liveness + `ppid` (a real
  detached monitor has ppid=1 via setsid) + age. Do NOT count `pgrep -f 'tiller __monitor'` matches.
- flock HELD on `dispatch/tiller.lock` = a live monitor holds it.
- driver.log **content** (is the last line a real dispatch/verdict/localize?) over LONG windows — hard
  fences legitimately take 5-10+min with NO commit during localize/rewrite, so "no commit in 4min" is
  NORMAL on the fence tail, not a stall.
- To scope any process check to THIS run, always grep for `command-center-2026-08-26` AND exclude `$$` and
  `bash -c`/`pgrep` cmdlines.

Net: do not restart the tiller on a churn/no-commit read alone. Restart ONLY when tiller.pid's own process
is dead/zombie (flock FREE while it lingers) or the SAME driver.log content is frozen for >20min with the
authoritative pid alive.

## JROM notification
None — false alarm, run progressing, all work safe. Per "just complete this and let me know once ready,"
this folds into the eventual ready summary, not a ping.
