# Batch O7 Changes

User Report verbatim:

URGENT batch O7 first. O7 = 'working' must mean SUBSTANTIVE change: add normalizePaneForActivity() that strips ticking timers + spinner glyphs + chrome BEFORE hashing, so a pane whose only delta is a timer (like HRIS child's 'Waiting for background terminal (11m13s->16s)') is NOT 'working'. Use the normalized hash for coordinator+child change detection.

Root Cause mechanism:

O6 correctly changed activity classification from marker presence to pane hash changes, but the hash still used raw tmux output. Claude/tmux panes can redraw status chrome every few seconds while no meaningful work is happening. Timer text, spinner glyphs, token counters, and bottom hint bars made the raw pane hash change, so childPaneHashChanged stayed true and the workflow remained `working` forever.

Per-file WHY:

- `src/services/overmind-watcher.ts`: added exported `normalizePaneForActivity(text)` and routed `hashPane()` through it. Because all coordinator persistence, child hash tracking, and post-action hash updates use `hashPane()`, `last_pane_hash`, the in-memory child hash map, `handleAllTasksDone`, `applyNudgeLadder`, `applyDecisionInterception`, `applyTier3Brain`, and `updateChildPaneHashes` now compare normalized pane content.
- `tests/overmind-classifier.test.ts`: added pure normalization regressions for the HRIS timer/spinner-only child pane delta, plus workflow classification coverage proving that timer-only child churn does not count as working and substantive child output still does.

Autonomous decisions:

- Kept the normalization behind `hashPane()` instead of adding a second hash function, so existing watcher call sites cannot accidentally keep using raw pane hashes.
- Existing stored raw `last_pane_hash` values may cause one transitional "changed" tick after deployment; subsequent ticks persist normalized hashes and timer-only churn stops counting as activity.
