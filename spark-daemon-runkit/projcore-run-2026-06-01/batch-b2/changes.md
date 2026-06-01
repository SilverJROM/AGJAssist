# Batch B2 Changes

## User Report

You are the IMPLEMENTER (codex). /projcore from AGJ-51. ⭐ PIVOT — INJECT-002 is COMPLETE; we're back to the SPARK DAEMON. New batch — read+execute IN FULL (real handshake): /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b2.md (GET active-runs endpoint R7, served from the overmind_projects⋈overmind_workflows join per R12.8; response shape per R7.1; loopback+token auth; daemon-side TTL cache is NOT this batch). Conventional commit. Handshake: STATUS: PROPOSED then WAIT. Callback FIRST. DISPATCH-MARKER: AGJ-B2

## Root Cause

The spark daemon needs a server-side registry endpoint, but AGJAssist did not have a canonical active-runs route. INJECT-002 also changed the source of truth: active daemon-monitorable runs must come from `overmind_workflows.project_id -> overmind_projects.id`, not legacy workflow-only fields.

## What Changed

- Added `OvermindService.listActiveRunsForDaemon()`, which joins `overmind_workflows` to `overmind_projects` and filters out terminal statuses (`completed`, `failed`, `paused`).
- Added canonical `GET /api/overmind/runs/active` with loopback plus Overmind token authentication.
- Mapped the R7.1 response shape, including `parent_session`, parsed child session/role pairs, and sorted absolute dispatch manifest paths from `<run_dir>/dispatch/*.json`.
- Added targeted route tests for empty registry, active project-backed row, terminal/legacy exclusion, manifest listing, child parsing, and auth rejection.

## Per-File Why

- `src/services/overmind-service.ts`: owns the SQL join and active-run selection so the route does not duplicate database concerns.
- `src/api/routes/overmind-routes.ts`: exposes the canonical Overmind endpoint, reuses loopback-token auth for GET, and assembles filesystem-derived dispatch manifest paths.
- `tests/overmind-routes.test.ts`: proves the route contract and guards against returning terminal or legacy null-project rows.

## Caveats

- No `/api/runs/active` alias was added by instruction; B5 will wire the daemon to `/api/overmind/runs/active`.
- R7.3 daemon-side 30s TTL cache remains deferred to the daemon batch.
- Autonomous decisions: none beyond the approved plan.

