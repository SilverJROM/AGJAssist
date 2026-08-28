# 2026-08-28 north targeted resume — REFUSED (seats not idle)

North asked: reap 3 idle glimmer, restart driver (no second writer), restart monitor 2805424.

Checked 2026-08-28T05:24Z. **Did not execute (a) or (b).**

## Why
1. **Seats are not idle.** All three `impl_glimmer` show `Waiting for response` (lkAsst 10m, this-run 11m, lokalAI-v2 22m). Not empty-prompt finished.
2. **Two of three are other runs.** `x-tlre093e95f7fd0` cwd lkAsst; `x-tlrfa6c37db1133` cwd lokalAI-v2. This run owns only `x-tlre7cd71a78feb_*`.
3. **On-disk driver.log frozen at 147 lines is the park-rollback file.** Process 1679354 still writes to a **deleted** `tiller.log` inode (fd1/2). Disk `driver.log` is not the live stream. STATUS is NOMINAL, D0 in-flight, pidfile already **1679333** not 2805424.
4. Killing this-run glimmer or `tiller resume` while 1679333 lives would destroy the live D0 turn and/or start a second writer.

Cannot break a "reconcile loop" that is actually a live wait + deleted-log illusion without destroying work. If JROM is needed, that is north's call.
