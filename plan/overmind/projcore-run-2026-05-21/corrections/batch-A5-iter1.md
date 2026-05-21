# Correction — Batch A5, iter 1

**Verdict:** PASS on the critical safety property (nudge goes to coordinator ONLY — child pane verified clean live). FAIL on escalation correctness (gate-2 functional). Targeted fix; A5's structure is PRESERVED.

## The bug (mechanism-level), proven live
Setup: throwaway `ovm-smoke-coord` (+ child `ovm-smoke-child`), idle. The watcher correctly marked it stuck after 90s and fired a Tier-1 nudge into the COORDINATOR (verified: pane shows "Overmind: you appear idle …" + "-bash: Overmind:: command not found"; child pane clean).

BUT: `tmuxService.sendCommand` TYPES the nudge text into the coordinator pane. On the NEXT tick, `classifyWorkflow` sees the coordinator pane hash CHANGED (because the nudge text is now there) → classifies `working` → `applyNudgeLadder` resets `nudge_count=0, tier=0` and the classifier clears `stuck_since`. Result: the ladder NEVER escalates to Tier 2; overmind perpetually re-nudges (~every 135s), mistaking its OWN nudge for coordinator activity. Observed row after the cycle: status `working`, nudge_count `0`, stuck_since `null` — despite the coordinator being dead-idle.

## The fix (exactly this)
**After overmind sends a nudge, record the POST-nudge pane state as `last_pane_hash`, and do NOT let the nudge itself count as activity.**
1. In `applyNudgeLadder` (src/services/overmind-watcher.ts), after `await tmuxService.sendCommand(coordinator, CANNED_NUDGE, true, true)`: re-capture the coordinator pane (`capturePaneSafe`) and compute its hash. Return that post-nudge hash so `tick`/`persist` writes `last_pane_hash = <post-nudge hash>` (overriding the pre-nudge `result.coordinatorHash`).
   - Effect: next tick compares the (settled) pane against the post-nudge hash. If the coordinator is STILL frozen (only overmind's nudge text present, nothing new) → hash unchanged → NOT working → stays `stuck` → escalates Tier 2. If the coordinator GENUINELY resumes (real new output beyond the nudge) → hash changes → `working` → ladder resets (correct).
2. Ensure `stuck_since` is NOT cleared on the nudge tick or by the immediately-following tick due to the nudge text. (Preserving the post-nudge hash achieves this — the next tick takes the frozen path and preserves stuck_since.)
3. Keep Tier cap (MAX_CANNED_NUDGES=2) and the Tier-3 hook intact.

Be careful threading the post-nudge hash back into the single `overmindService.update` call (don't double-update; compute nudgeFields + the hash override, then persist once).

## Tests to add
- Unit test simulating: tick1 pane=idle→stuck→Tier1 nudge (capturePane mock returns pane-without-nudge first); tick2 capturePane mock returns pane-WITH-nudge-text-only (i.e. the nudge is the only delta) → assert status stays stuck and tier escalates to 2 (NOT reset to working/0).
- Keep existing A5 nudge tests green.
- `npx tsc` clean.

## Preserved (do NOT redo)
Coordinator-only targeting, DONE notify from /complete, Tier cap, notify plumbing, reset-on-genuine-working. Only fix the self-nudge-as-activity loop.

## Re-verification projcore will run
Re-run the live smoke (idle throwaway coordinator): expect Tier1 then Tier2 then STOP (no infinite re-nudge), stuck_since preserved across the nudge, child pane clean.

## Completion
Append callback FIRST `[projcore callback] A5 DONE <note>` (after fix), THEN reply STATUS: DONE -- reason. Correction iter 1.
