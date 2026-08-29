# Decision — grok46→sonnet5 validator swap, executed via a pinned engine (2026-08-28)

logged by `[north]`. JROM directive (relayed by wflow-c1): grok46 at 3% weekly quota → swap to sonnet5 on
any working run; pre-authorized by topology.yaml line 25's fallback clause. JROM chose **Pin + swap** via
AskUserQuestion. Revert clause: **resume grok46 only if still working after Sat 2026-08-29 23:35 Manila
(15:35 UTC)**; finished by then, do nothing. Durable note: `~/.config/agent-protocols/GROK46-QUOTA-2026-08-28.md`.

## Why pinned (not a bare swap)
The driver was running `projcore-driver.py` directly from wflow's shared repo working copy, so a restart
would adopt whatever wflow's tree held — including today's unreviewed changes AND an uncommitted
`load_ac_text` rewrite. Pinning freezes a controlled snapshot so future restarts adopt what we chose.

## What was done
1. Froze the current working snapshot to `~/.tiller-pinned/agj-command-center/` (15 files). Fingerprint
   matched wflow-c1's tested value `01ce60b8…` exactly.
2. Kept the uncommitted `load_ac_text` change — it is **load-bearing**: wflow-c1 measured 0 ACs parsed
   without it vs 32 with it on this run's og-requirements. Reverting would restore a broken state.
3. Stopped the live run (killed driver 2086261 + monitor 2086240; F0c mid-validation, impl commit 2f3bcce
   safe on HEAD → re-validates on resume), reaped idle seats, cleared the PAUSE flag.
4. Swapped `VAL_L1=VAL_L2=sonnet5` in **both** run.env (bare assignments — wflow's `^export` sed was a
   no-op, used a bare-pattern sed) and topology.yaml lines 55-56 (preflight refuses on stamped≠resolved).
5. Cleared repo-root untracked fence scratch (`.cc-fence-*`, `fence-report-v1.json.test_*.json`) that the
   product-clean preflight gated on (`--allow-baseline-dirt` doesn't cover it).
6. Resumed FROM THE PIN: `bash ~/.tiller-pinned/agj-command-center/tiller resume … --allow-engine-change`.
   Vacuous-fence checks came through as WARN (resume-semantics), preflight OK 43/43, launched detached.

## Verified
Driver 3064678 + monitor 3064650 both running from the pin path (via /proc cmdline); flock HELD; tiller.pid
correct (3064650); VAL_L1/L2=sonnet5 in run.env + topology; run reconciled and re-driving F0c (38/43).
**Coordinator (projcore x-01_projcore_grok46) left on grok46 per JROM — swap only if it dies.**

## Notes
- `preflight` (start-strict) FAILS on B8/C6/D7/E5/F7 vacuous fences; `resume` WARNs and proceeds — a dry-run
  reads scarier than the actual resume. Flagged to wflow-c1.
- Benign "DEFENSELESS CONFIG" warning: topology.yaml is git-tracked, so the edit shows in git.
- Revert-after-Sat is durable in `GROK46-QUOTA-2026-08-28.md`; run likely finishes first (38/43).

## PART 2 — coordinator swap (grok46 hit 0 credits ~15:10) + dead-watcher fix
The "swap projcore only if it dies" trigger fired sooner than the run finished: grok46 exhausted, projcore
(x-01_projcore_grok46) wedged ("purchase more credits"). Driver + validators unaffected (already sonnet5).
wflow-c1 also caught that the **escalation watcher was DEAD** for this run (old 8h-ceiling silent exit),
so part of the 24-RAISE backlog was a delivery gap, not a wedged seat.

Executed wflow-c1's sequence:
1. Spawned `x-02_projcore_sonnet5_agjassist` (claude sonnet5, in repo dir), loaded persona via `/projcore`,
   sent a RESUME brief (not a bootstrap; north rulings E5-a11 / F7-F0b / D7-advance stand).
2. Plumbing (the escalation-watch reads coord from `.session`, re-parsed live each cycle — no restart of
   consumers needed): `.tiller-identity.json` `.session` → x-02; appended `spawned_sessions.txt`; stamped
   `coordinator_session: x-02…` into topology.yaml (re-arms the self-drive guard, was inert/empty before).
3. Started a fresh escalation-watcher FROM THE PIN with `TILLER_WATCH_MAX_LIFE_SEC=172800` (48h; pin has
   today's 8h-ceiling fix).
4. Verified: x-02 heartbeat — "projcore(sonnet5, replacement for grok46/quota-dead) picked up coordination;
   all 24 RAISEs cross-checked against DIRECTION mtimes — every one already answered" (stale echoes, correct
   dedup). Watcher delivered an escalation to x-02. THEN killed x-01 (grok46) last.

**Final: 0 grok46 sessions for this run.** Coordinator + validators sonnet5; driver + watcher from the pin;
flock held; 38/43. The whole grok46 question is now moot regardless of the Sat reset — run finishes on
sonnet5. Verifier≠fixer preserved (implementers glimmer/terra/sonnet5/sol; coordinator sonnet5 ≠ its own
validators via the per-attempt floor).
