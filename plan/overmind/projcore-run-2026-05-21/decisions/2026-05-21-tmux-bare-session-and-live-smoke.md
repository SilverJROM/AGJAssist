---
date: 2026-05-21
project: AGJAssist
type: autonomous-call
source: projcore
priority: high
search_hooks: [tmux, capturePane, ensureValidTarget, bare-session, live-smoke, overmind, watcher]
---

**Decision 1 — tmux bare-session targets.** `tmuxService.ensureValidTarget` only accepted `session:window.pane`; overmind registers coordinators by bare session name. Widened the validator to accept bare session names too (kept injection-safe, kept existing format). Necessary for the whole watch/nudge premise.

**Decision 2 (process lesson — promotion candidate) — live smoke is mandatory for tmux-touching batches.** A4's unit tests (synthetic panes) were green while the watcher read EMPTY from every real pane. Only the live smoke (register a workflow at a real session, read the resulting row) caught it. **Rule:** every batch that depends on tmux capture/send (A5 nudge, A7) MUST be live-verified against a real session, not just unit tests. Synthetic-pane unit tests prove the classifier logic; they cannot prove the tmux integration.

**Counterfactual:** trusting green unit tests would have shipped a watcher that classifies every workflow as frozen→stuck and (in A5) nudges constantly — the opposite of the goal.

**Promotion target:** projcore §1.11 evidence gate / a JROM style note — "for integration-boundary code (tmux, external CLI), a live smoke is part of the gate, not optional."
