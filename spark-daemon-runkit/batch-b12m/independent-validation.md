# Batch B12m Independent Validation

Validation performed locally against the implemented diff.

## Evidence

- `src/tools/propose-overmind-projects.ts` uses `DatabaseService` and queries `overmind_workflows WHERE status = 'completed'`.
- `deriveAppPath()` checks the run directory exists, realpath-canonicalizes it, walks to `project_specs.md`, then falls back to `.git/`.
- `analyzeCompletedWorkflows()` groups by derived app path and records missing/non-marker paths as `review_needed`.
- `buildProposal()` includes `slug`, `app_path`, `parent_session`, `source_workflow_id`, workflow ids, and the POST body.
- Slug conflicts set `slug_conflict: true` and `commit_eligible: false`.
- `formatDryRunOutput()` only formats text and curls; it has no network path.
- `commitProposals()` requires owner bearer auth from caller, preflights `GET /api/overmind/projects`, skips ineligible proposals, and stops on failed POST responses.

## Commands

- `npx vitest run tests/overmind-project-migration.test.ts` PASS.
- `npm run build` PASS.
- `npx tsx src/tools/propose-overmind-projects.ts --help` PASS.
- `npx tsx src/tools/propose-overmind-projects.ts --db data/agjassist.db --dry-run | sed -n '1,80p'` PASS.

## Verdict

R12.9/T12.9 script deliverable is satisfied. No live project rows were created during validation.
