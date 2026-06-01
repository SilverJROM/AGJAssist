# Decision — parent resolution failure sends as unknown

## Context

B12i parent-nudge guard correctly suppresses confirmed `bare-bash` and `no-session` parent panes, but a parent resolver failure is not proof that the parent is orphaned.

## Decision

If `getParentSessionForWorkflow` is missing or throws, fall back to the workflow coordinator. If it throws, skip pane classification, mark the send result as `paneKind: unknown`, warn, and send the nudge.

## Reason

A nudge path must not crash because parent resolution failed. Confirmed orphan suppression remains unchanged; only resolver failure fails open.
