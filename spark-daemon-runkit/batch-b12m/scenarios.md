# Batch B12m Scenarios

## Covered

- Completed-only seed query: only `overmind_workflows.status = 'completed'` rows are analyzed.
- App path derivation: existing `run_dir` walks upward to `project_specs.md`; `.git/` is used as fallback.
- Canonical grouping: derived app paths are realpath-canonicalized and grouped before proposal output.
- Parent source: proposal uses the most recent completed workflow's `coordinator_session` and prints the source workflow id.
- Slug selection: conservative label prefix is used when stable; basename fallback remains available for varied labels.
- Conflict safety: duplicate proposed slugs are marked as `slug_conflict` and excluded from commit.
- Missing path safety: nonexistent `run_dir` creates a `review-needed` row and is skipped.
- Dry-run safety: default command prints bodies/curls and executes no HTTP.
- Commit safety: `--commit` requires owner bearer token, preflights existing projects, excludes conflict/review rows, and stops on 409/403.

## Commands

- `npx vitest run tests/overmind-project-migration.test.ts`
- `npm run build`
- `npx tsx src/tools/propose-overmind-projects.ts --help`
- `npx tsx src/tools/propose-overmind-projects.ts --db data/agjassist.db --dry-run | sed -n '1,80p'`
