Batch-B11 test report

Verification:
- `npx vitest run tests/overmind-service.test.ts tests/overmind-routes.test.ts tests/overmind-sanitize.test.ts` PASS.
- `npx tsc --noEmit` PASS.
- `npx vitest run` PASS: 40 files, 543 passed, 1 skipped.
- `npm run build` PASS.
- `pm2 restart agjassist` PASS; process `agjassist` online.

Focused coverage:
- Added unit coverage for processing -> done actual time computation from fixture task_log timestamps.
- Updated API/task shape expectations to include `actual_min: null` where no actual elapsed time exists.

Screenshot proof:
- Captured real dashboard Overmind workflow tile via headless Firefox/geckodriver.
- Screenshot shows parent session, child roster, full task list, and est-vs-actual values.
- Path: `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b11/screenshots/b11-overmind-est-vs-actual.png`
