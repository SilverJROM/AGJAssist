# B12g Independent Validation

## Result

PASS.

## Evidence

- Attach register path calls the B12b `isAgentPane()` helper only after `registerAttached()` succeeds.
- `bare-bash` and `no-session` are warn-only: tests assert HTTP 201, persisted `workflow.parent_status`, and `parent_warning`.
- Detector failure is non-fatal: tests assert HTTP 201, `parent_status='unknown'`, and no `parent_warning`.
- Legacy register path remains outside the changed attach branch.
- Build and focused tests passed.

