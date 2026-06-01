# Batch B12m Changes

## User Report

Batch B12m: migration script R12.9a. Build a safe dry-run-default proposer from completed workflows only, derive canonical app paths from run_dir, group by app_path, propose `POST /api/overmind/projects` curls, skip active/pending/in-progress workflows, mark missing run_dir as review-needed, fail closed for `--commit`, fixture-test it, and make a conventional commit.

## Root Cause

R12 introduced JROM-owned `overmind_projects`, but old completed `overmind_workflows` still contain the only historical mapping from workflow run directories to real app roots and parent sessions. Creating projects directly from all workflows would import active ghosts and typo runs; creating paths from missing run directories would invent unsafe project rows.

## Files Changed

- `src/tools/propose-overmind-projects.ts`
  - Added a TS CLI that uses `DatabaseService` to query completed workflows only.
  - Added pure helpers for app path derivation, label-prefix slug choice, proposal formatting, and guarded commit execution.
  - Default mode is dry-run and prints JSON bodies plus curl commands.
  - `--commit` requires an explicit owner JWT and preflights existing projects before POSTing eligible proposals.
- `tests/overmind-project-migration.test.ts`
  - Added temp-DB/temp-filesystem fixture coverage for completed-only selection, `project_specs.md` and `.git` walk-up, grouping, slug conflicts, missing run_dir review rows, dry-run output, and 409 fail-closed commit behavior.

## Verification

- `npx vitest run tests/overmind-project-migration.test.ts` PASS.
- `npm run build` PASS.
- `npx tsx src/tools/propose-overmind-projects.ts --help` PASS.
- Real dry-run against `data/agjassist.db` printed proposal/review-needed output and did not execute HTTP.

## Autonomous Decisions

See `decisions/2026-06-01-migration-cli-commit-guard.md`.
