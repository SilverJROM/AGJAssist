---
date: 2026-05-21
project: AGJAssist
type: autonomous-call
source: projcore
priority: medium
search_hooks: [overmind, branch, merge, integration-branch, policy]
---

**Decision:** The entire overmind build runs on a single integration branch `feat/overmind` (renamed from the auto-created `feat/overmind-a1-schema`). Commit per batch. NO merge to master until JROM reviews the whole feature at the end.

**Trigger:** Frontload gap — I did not lock a commit/branch/merge policy in the §1.4a interview. Closing it now rather than mid-build per-batch.

**Reasoning:** Batches are sequential and dependent (A2 builds on A1), so per-batch branches off master would not carry prior code. Merge-to-master is escalate-class (trust-defaults / the very decision-tree R15 guards). Keeping one integration branch + deferring the master merge to a JROM review keeps the irreversible step in JROM's hands.

**Counterfactual:** Per-batch branches merged to master on each PASS — rejected (auto merge-to-master is escalate-class; also breaks the dependency chain).

**Promotion target:** projcore §1.4a frontload checklist already lists "commit/branch/merge policy" — reinforce that it must be answered at intake.
