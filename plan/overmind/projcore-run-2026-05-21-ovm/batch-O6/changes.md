# Batch O6 Changes

User Report verbatim:

URGENT classifier fix — activity = pane CHANGE, not stale marker text. A stuck coordinator was classified `working` forever because `Waiting for` matched idle recap text. `working` must require actual coordinator pane change, child pane change, or run dir mtime advancement.

Root Cause mechanism:

`classifyWorkflow`, `classifyParentSession`, and `classifyChildSessionStatus` treated busy-marker text as current activity. Because the regex included `Waiting for`, a frozen coordinator pane containing an old recap line could keep the workflow in `working` without any pane hash change or run directory activity, so stuck accrual and nudging never happened.

Per-file WHY:

- `src/services/overmind-watcher.ts`: removed standalone busy-marker activity from workflow, parent, and child status classification. Added per-workflow in-memory child pane hashes so child activity is based on hash changes across ticks. Kept coordinator hash persistence in `last_pane_hash`.
- `tests/overmind-classifier.test.ts`: added direct regressions for frozen `Waiting for` recap text becoming `stuck`, frozen coordinator plus changed child becoming `working`, parent marker text not forcing `working`, and child marker text requiring a pane hash change.
- `tests/overmind-nudge.test.ts`: added watcher-level lkcamp regression proving stale `Waiting for` text past threshold sends the canned nudge.
- `tests/overmind-stream.test.ts`: covered child hash tracking across watcher ticks and adjusted child status expectations to use pane changes instead of marker text.

Autonomous decisions:

- Count an initial child pane observation as activity only when the workflow has no prior coordinator pane hash (`last_pane_hash === null`). This preserves the requested first-observation behavior for new workflows while avoiding a watcher restart silently clearing an already-established stuck or decision state.
