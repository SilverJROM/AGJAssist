# Batch B12j Test Report

## Build And Static Checks
- PASS: `node --check src/web/public/app.js`
- PASS: `node --check src/web/public/overmind-helpers.js`
- PASS: `npm run build`

## Focused Existing Tests
- PASS: `npm test -- --run tests/overmind-routes.test.ts tests/overmind-service.test.ts -t "overmind project|overmind_projects"`
- Result: 2 files passed; 7 tests passed; 83 skipped by filter.

## Running App Proof
The already-running `http://localhost:3101` process was stale and returned `404` for `GET /api/overmind/projects`, so it was not disturbed. A proof server was started on `http://127.0.0.1:3102` with `TEST_MODE=true` and throwaway DB `tmp/b12j-live.db`.

API proof:
- PASS: owner `GET /api/overmind/projects` returned `200 {"projects":[]}` before create.
- PASS: owner `POST /api/overmind/projects` with `slug=b12j-proof`, `app_path=/home/agjrom/TGBOTS/AGJAssist`, `parent_session=AGJ-51` returned `201`.
- PASS: owner `GET /api/overmind/projects` returned the new row with `active_runs_count: 0`.
- PASS: duplicate create returned `409 {"error":"project slug or app_path already exists"}`.
- PASS: bad relative path returned `400 {"error":"'app_path' must be an absolute path"}`.
- PASS: viewer JWT create returned `403 {"error":"projects are JROM-managed; ask JROM to create via dashboard"}`.

Browser proof:
- PASS: Playwright opened `/overmind-projects`, clicked `+ New Project`, filled `b12j-ui`, submitted, waited for the new row, and verified the SQLite row:
  `b12j-ui|/home/agjrom/TGBOTS/AGJAssist/tmp/b12j-ui-app|AGJ-51|Created through B12j modal`
- PASS: Playwright verified modal-visible duplicate `409` error text.
- PASS: Playwright verified modal-visible bad path `400` error text.
- PASS: Playwright verified modal-visible viewer `403` error text.

Screenshots:
- `screenshots/overmind-projects-ui-created-row.png`
- `screenshots/overmind-projects-created-row.png`
- `screenshots/overmind-projects-bottom-nav.png`
