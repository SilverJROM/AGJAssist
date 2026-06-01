# B12f Independent Validation

## Validation Summary
PASS.

## Evidence
- Diff review confirms `/api/overmind/register` now splits new attach from legacy by shape before legacy validation.
- Diff review confirms forbidden derived fields are only rejected on the attach path, not on valid legacy `label + session` payloads.
- Diff review confirms project matching realpath-normalizes the incoming run dir and project app paths, then walks upward to root.
- Diff review confirms attached workflows use `(project_id, run_dir)` lookup/upsert and do not copy `parent_session` into `coordinator_session`.
- Targeted tests and build passed.

## Residual Risk
- Broader watcher/nudge behavior for attached rows is intentionally deferred to the later R12 parent-routing batches.

