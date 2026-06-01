# B12k Test Report

## Automated

- `npm test -- --run tests/overmind-routes.test.ts -t "overmind projects|parent_status"`
  - PASS: 1 file, 4 tests passed, 45 skipped.
- `npm run build`
  - PASS.

## Local UI Proof

Server: `http://localhost:3101` restarted from current `dist/` after build.

Seeded projects:
- `b12k-warn`: latest attached workflow `parent_status='bare-bash'`.
- `b12k-active`: active workflow, delete returns 409 and row remains.
- `b12k-delete-ok`: zero active runs, delete removes row.
- `b12k-ok`: latest attached workflow `parent_status='ok'`, no warning indicator.

Screenshots:
- `screenshots/01-list-warning-active.png`
- `screenshots/02-edit-modal-immutable-fields.png`
- `screenshots/03-edit-reflected.png`
- `screenshots/04-delete-409-row-kept.png`
- `screenshots/05-delete-success-row-removed.png`
- `screenshots/06-ok-project-no-warning.png`
