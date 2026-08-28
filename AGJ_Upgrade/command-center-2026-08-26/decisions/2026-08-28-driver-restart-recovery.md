# Decision — [north] restarted the wedged tiller driver (2026-08-28 ~05:25Z)

logged by `[north]`. A high-touch intervention (killed + resumed the tiller), documented for audit + the
ready summary.

## The deadlock
After a park-rollback truncated `dispatch/driver.log`, the run entered a two-sided deadlock:
- **Monitor 1679333 = zombie:** the process was alive but had **released its authoritative flock**
  (`tiller.lock` tested FREE via `mon_live`, though the monitor holds fd 9 for life at tiller:550) — so it
  was no longer the single-writer, and its heartbeat froze at a dead relic pid 2805424 (`STALLED/done:5`).
- **Driver 1679354 = wedged:** stuck re-writing the same post-rollback RECONCILE digest (driver.log frozen
  at 147 lines despite a ~1min mtime), not consuming DIRECTIONs, not closing RAISEs, not landing commits.
- **projcore = spinning:** because the driver never closed RAISEs, the tiller **re-delivered the same
  RAISEs** (C5/C6/D0/D5…); projcore kept writing duplicate DIRECTIONs (a3→a4 SKIPs, ctx climbing to
  ~275K) and could not even read north's messages. Open-RAISE count pinned at 11, refs pinned at 7, HEAD
  frozen — ~25min zero forward motion. projcore could NOT self-recover (root cause was the driver, not it).

## Why north intervened directly (not just prompt projcore)
projcore was provably deadlocked and unreadable; the fix was mechanical (restart the driver). ALL slice
work was preserved in git refs (zero data-loss risk), and `tiller resume` is the *supported* recovery
("parks persist → continues"). The tiller.lock tested FREE, so a resume would cleanly take over. Per
JROM's "autonomous self-resolution / just complete this," north did the restart rather than escalate what
JROM would simply approve.

## The recovery (steps)
1. Verified git not mid-rebase/merge; heads-up to projcore ("taking over the restart; STAND DOWN tiller
   lifecycle") — projcore stood down cleanly.
2. Killed zombie monitor 1679333 + wedged driver 1679354 (explicit PIDs, TERM→KILL); reaped the 3 idle
   `impl_glimmer` seats (freed the lokalAI lease). Verified **both** flocks (tiller.lock + repo-lock) FREE.
3. `tiller resume --run-dir <RUN> --repo <REPO> --allow-baseline-dirt --allow-engine-change`, with
   `run.env` sourced into the shell first (preflight reads the roster from the ENV of the invoking shell;
   the monitor re-sources it at tiller:540). `--allow-engine-change` because the L1_ATTEMPTS-default commit
   changed the engine mid-run (this run already adopted it). Restored the one dirty product file
   `e2e/command-center-summaries-fence.spec.ts` to HEAD (D0 WIP, safe in `refs/tiller/.../D0`).
4. Preflight OK (41 plan / 41 queue rows; B8/C6/D7/E5/F7 vacuous-fence WARNs are known, non-blocking).
   Launched detached. Fresh **monitor 3583119** (holds flock) + **driver 1686697**, actively dispatching
   (fence E5 → codex55 authoring the wakeup-fence spec). north routing intact (`north_session=agj-3767`).

## True state after recovery
**32 DONE / 9 PENDING of 41 (78%)** per projcore's marker accounting. The 9 pending are the fence tail +
G-release slices. Nothing lost.

## Watch-for
The zombie's root cause (monitor releasing its flock while alive) is not fully understood — possibly the
mid-run engine swap or a park-rollback bug. Oversight now also checks **`mon_live`**: if `tiller.lock`
tests FREE again while processes linger, the driver re-zombied → repeat this recovery.

## JROM notification
None now — recovered autonomously, no data lost. Folds into the eventual ready summary (which will call out
this recovery + the fence-stub-in-prod release gate).
