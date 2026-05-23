---
date: 2026-05-21
project: AGJAssist / overmind
type: follow-up-recommendation
source: projcore
priority: medium
search_hooks: [overmind, stuck, waiting_human, standing-by, false-nudge, awaiting-jrom, refinement]
---

**Finding (surfaced onboarding the 3 live workflows):** overmind's deterministic classifier cannot distinguish a coordinator that is *stuck* (codex died / callback that will never arrive) from one that is *legitimately standing by for JROM* (run done, awaiting a test/sign-off/decision). Both look frozen with no busy markers. So overmind would false-nudge an idle-awaiting-JROM coordinator with "check your implementer pane" — wrong (it's waiting on JROM, not codex), and noisy.

**Why it didn't bite now:** hris-d-22 has live monitors ("5 shells, 3 monitors") that keep its pane changing → classified working. lkcamp + lkvc were registered PAUSED (done/awaiting-JROM) so the watcher skips them.

**Recommended follow-up refinement (a future overmind issue):** teach the classifier/brain to treat "standing by for JROM" as `waiting_human` (not `stuck`). Signals: explicit "Standing by"/"awaiting your"/"let me know" phrasing, OR no in-flight codex work (child idle + no pending callback in callbacks.md) — i.e. if the COORDINATOR is idle but there's nothing for codex to do, it's waiting on JROM, not stuck. Could also let the Tier-3 Sonnet brain make this call from the pane + callbacks tail before nudging.

**Not blocking:** overmind works correctly for genuinely active runs (codex churning) — proven in the A4/A5/A6a live smokes. This refinement matters for runs in their JROM-handoff phase.
