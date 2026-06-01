# B12g Scenarios

## Covered

- Attach register with a project parent_session classified as `codex` returns 201, persists `parent_status='ok'`, and omits `parent_warning`.
- Attach register with a project parent_session classified as `bare-bash` returns 201, persists `parent_status='bare-bash'`, and includes `parent_warning.code='parent-session-bare-bash'`.
- Attach register with a project parent_session classified as `no-session` returns 201, persists `parent_status='no-session'`, and includes `parent_warning.code='parent-session-no-session'`.
- Attach register remains non-fatal when the detector throws: returns 201, persists `parent_status='unknown'`, and omits `parent_warning`.
- Legacy label+session register path was not changed.

