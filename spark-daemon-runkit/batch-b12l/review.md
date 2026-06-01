# B12l Review

## Scope Check

PASS. Changes are limited to:
- R12.5 live spec docs and committed snapshots.
- Overmind parent-nudge guard robustness.
- Overmind test fixtures/expectations for the approved widened scope.
- B12l artifacts.

No dashboard, server route, database schema, or client behavior was changed.

## Diff Notes

- The parent guard still suppresses confirmed `bare-bash` and `no-session` parents.
- Resolver failure is distinct from confirmed orphan status: it falls back to the workflow coordinator and sends with `paneKind: "unknown"`.
- Tests that are not about orphan suppression now mock `isAgentPane` as `codex`, preserving their original reconcile/subagent/decision/brain intent.
- Tests that intentionally cover no-session suppression still assert suppression.

## Risk

Low. The production code change is fail-open only when parent resolution itself errors; confirmed missing/bare parent sessions still fail closed with parent-orphan handling.
