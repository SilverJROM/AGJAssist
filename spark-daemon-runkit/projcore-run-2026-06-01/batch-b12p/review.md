# Batch B12p Review

## Scope

PASS. The change is limited to the consolidated acceptance spec and B12p artifacts. No production route, service, or UI code was changed.

## Acceptance Mapping

- T12.6: PASS. Owner create path returns `201`; list response includes the row; persisted project row exists with `created_by: JROM`.
- T12.7: PASS. DELETE with an active attached workflow returns `409` and preserves the row; after `setStatus(..., "completed")`, DELETE returns `200` and removes the row.
- T12.8: PASS. Mocked bare-bash parent returns `201` with `parent_status: bare-bash`, `parent_warning.code`, and persisted workflow parent status.

## Risk Review

- The tests assert outcomes, not just calls.
- The delete guard uses the real register path to create the active workflow instead of manually faking only the count.
- The bare-bash test explicitly checks both response and persisted workflow state.
- No acceptance weakening, skips, or `.only` markers were introduced.
