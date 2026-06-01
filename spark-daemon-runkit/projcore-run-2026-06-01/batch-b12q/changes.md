# B12q Changes

## User Report

APPROVED-PLAN for B12q. Complete and deterministic - T12.9 via the B12m helpers (analyzeCompletedWorkflows/formatDryRunOutput) proving zero-network + active/pending-ignored + review-needed, T12.10 via the app.inject temp-DB harness (create AGJ -> register-by-run_dir -> 201 derived AGJ + DB attach + GET), live :3101/wf=4/db untouched, B12n referenced. The helper-level dry-run is the right deterministic choice. Proceed - this completes INJECT-002. Callback FIRST on DONE.

## Root Cause

R12.10 already had acceptance coverage for T12.1-T12.8, and B12m/B12n had proven the migration proposer and live AGJ attach path separately. The remaining gap was durable, repeatable acceptance coverage for the final two outcomes without touching live overmind state.

## Changes

- `tests/acceptance/overmind-projects-migration.acceptance.test.ts`
  - Adds T12.9 coverage using the B12m helper surface: `analyzeCompletedWorkflows` plus `formatDryRunOutput`.
  - Adds T12.10 coverage using an isolated Fastify `app.inject` harness, temp DB, owner JWT, and a disposable ignored run directory under the real AGJ app path.

- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b12q/*`
  - Adds B12q scenario, change, review, test, validation, and no-decision artifacts.

## B12n Reference

B12n live evidence remains the operational proof: live `:3101` had the real AGJ project, a separate disposable workflow attached under AGJ, the disposable workflow was deleted, and `wf=4` was protected. B12q intentionally re-proves the same attach mechanism in a deterministic temp-DB harness instead of mutating live state again.

## Caveats

No production code changed. Live `:3101`, workflow `wf=4`, and `data/agjassist.db` were not accessed or modified by the B12q acceptance tests.
