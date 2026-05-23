# Batch W5 Test Report

Commands:
- `npx vitest run tests/overmind-service.test.ts tests/overmind-stream.test.ts`
- `npx tsc`
- `npm run build`

Results:
- PASS: targeted vitest, 2 files, 20 tests.
- PASS: TypeScript compile.
- PASS: production build.

Covered scenarios:
- New v15 schema includes `run_started_at` and `accumulated_ms`.
- Legacy overmind rows migrate idempotently and backfill `run_started_at = created_at`.
- New register starts with `accumulated_ms = 0`.
- Re-register resets `run_started_at`, rolls prior current-run elapsed into `accumulated_ms`, and recomputes `ended_at`.
- Elapsed helper handles live current runs, frozen completed runs, SQLite datetime strings, ISO timestamps, nulls, total elapsed math, and formatting.
