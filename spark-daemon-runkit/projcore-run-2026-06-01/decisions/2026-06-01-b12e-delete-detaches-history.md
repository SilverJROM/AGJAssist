---
date: 2026-06-01
batch: B12e
type: autonomous-call
priority: medium
search_hooks: [B12e, overmind_projects, delete, active_runs_count, project_id, foreign-key]
---

# B12e Project Delete FK Handling

## Context
R12.2 requires `DELETE /api/overmind/projects/:slug` to delete a project when `active_runs_count(slug) == 0`, and R12.1 links `overmind_workflows.project_id` to `overmind_projects(id)`.

With the FK in place, deleting a project that only has terminal historical workflows still fails unless those workflow rows are detached or removed. Removing workflow history is broader than B12e and would lose useful audit/history data.

## Decision
Keep the route-level guard as the authority for active work:

- If `activeRunsCountForProjectSlug(slug) > 0`, return 409 and leave all rows unchanged.
- If the active count is 0, `deleteProjectBySlug` first sets `overmind_workflows.project_id = NULL` for that project, then deletes the project row.

## Consequence
Completed/failed/paused workflow history survives project deletion without an FK violation. Active or working runs still block deletion because the route checks the same non-terminal count helper used by GET responses.
