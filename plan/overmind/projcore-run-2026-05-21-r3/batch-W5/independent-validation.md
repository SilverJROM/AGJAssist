# Batch W5 Independent Validation

Requirement WU5:
Display current-run elapsed time reset on every register, preserve a separate accumulated total, and migrate existing rows safely.

Validation:
- PASS: schema version is v15.
- PASS: new installs create `overmind_workflows.run_started_at` and `overmind_workflows.accumulated_ms`.
- PASS: migration from a legacy v11 overmind table adds missing overmind columns once and backfills `run_started_at` from `created_at`.
- PASS: `register()` for an existing coordinator session rolls prior elapsed into `accumulated_ms`, resets `run_started_at`, clears old run state, and recomputes `ended_at` from the new tasklist.
- PASS: `register()` for a new row initializes `accumulated_ms` to `0` and sets `run_started_at`.
- PASS: UI helper math uses `(ended_at ?? now) - run_started_at` for current elapsed and `accumulated_ms + current` for total.
- PASS: helper parsing supports ISO timestamps, SQLite `YYYY-MM-DD HH:MM:SS`, invalid/null starts, and frozen completed runs.

Gate:
- PASS: targeted tests, `npx tsc`, and `npm run build`.

Residual risk:
- Live smoke with an actual overmind re-register is still recommended by projcore, because this batch validated the service/helper behavior locally rather than driving the running app lifecycle end to end.
