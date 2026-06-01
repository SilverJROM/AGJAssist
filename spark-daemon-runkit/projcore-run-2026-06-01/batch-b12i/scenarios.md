# B12i Scenarios

## Covered

- Project-linked workflow whose `overmind_projects.parent_session` is an agent pane: guard sends the nudge to the project parent session.
- Legacy workflow with no `project_id`: guard falls back to `overmind_workflows.coordinator_session`.
- Project-linked workflow whose parent is `bare-bash`: guard suppresses the nudge, persists `parent_status='bare-bash'`, logs the suppression, and fires TG URGENT once.
- Repeated orphaned-parent nudge cycle for the same run: still suppresses, but does not fire TG URGENT again.
- Project-linked workflow whose parent is `no-session`: guard suppresses the nudge and persists `parent_status='no-session'`.

## Scope

- Covered nudge/reminder/idle parent sends from the watcher/nudge services.
- Left register corrective-advice and completion child-close route sends unchanged per approved scope.
