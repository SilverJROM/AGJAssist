# Batch B12m Test Report

## Targeted

Command:

```bash
npx vitest run tests/overmind-project-migration.test.ts
```

Result: PASS, 3 tests.

Coverage:

- Completed workflows are analyzed; active/working rows are ignored.
- `project_specs.md` walk-up and `.git/` fallback both derive canonical app roots.
- Multiple completed rows under one app path group into one proposal.
- Most recent completed row supplies `parent_session` and source workflow id.
- Duplicate proposed slugs are marked and excluded from commit.
- Missing `run_dir` produces `review-needed`.
- Dry-run output contains curls/bodies and no active workflow data.
- Commit path excludes conflicts/review rows and stops on 409.

## Build

Command:

```bash
npm run build
```

Result: PASS.

## CLI Smoke

Command:

```bash
npx tsx src/tools/propose-overmind-projects.ts --help
```

Result: PASS.

Command:

```bash
npx tsx src/tools/propose-overmind-projects.ts --db data/agjassist.db --dry-run | sed -n '1,80p'
```

Result: PASS. Printed dry-run proposals/review-needed rows and executed no HTTP requests.
