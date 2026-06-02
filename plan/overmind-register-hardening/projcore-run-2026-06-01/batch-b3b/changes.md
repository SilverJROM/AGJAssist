# Batch B3b Changes

## Branch: `feat/ovm-register-hardening`

Cut from existing batch branch with unrelated dirty workspace files already present.

## User Report

"After this batch, `POST /api/overmind/register` accepts ONLY the run_dir attach shape. The legacy `{label, session, run_dir, child_sessions, tasks}` branch is GONE. No code path can create a `project_id = NULL` workflow."

## Root Cause

The register route still contained a legacy full-payload branch that could call `OvermindService.register()` and insert/upsert workflows without a project identity.

## Code Changes

- `src/api/routes/overmind-routes.ts` - Removed the legacy post-attach register branch and returns `legacy-register-removed` for full legacy `{label, session, run_dir}` payloads.
- `src/services/overmind-service.ts` - Removed `register()`, `findProjectTreeMatch()`, `sharesProjectTree()`, legacy rollover helper, and orphaned path-matching helpers.
- `src/services/overmind/types.ts` - Removed `RegisterOvermindWorkflowInput` from the public type surface.
- `tests/overmind-fixtures.ts` - Added a project-attached workflow fixture helper so tests no longer depend on NULL-project workflow creation.
- `tests/overmind-*.test.ts` - Migrated remaining direct `service.register()` fixtures to project-attached fixtures and added the legacy-register rejection assertion.
- `/home/agjrom/.claude/agents/lib/overmind.sh` - Removed `_reregister_from_cache` legacy `/api/overmind/register` fallback; failed child sync now logs the `/children` failure only.

## Grep Proof

- `rg "service\\.register\\(|overmindService\\.register\\(" src tests --glob '*.ts'` -> zero matches.
- `rg "\\b(register\\(input|findProjectTreeMatch|sharesProjectTree|buildProjectTreeConflictMessage|REGISTER_CONFLICT_NUDGE_COOLDOWN_MS|RegisterOvermindWorkflowInput|priorRunElapsedMs|PROJECT_ROOT_DEPTH|pathComponents|pathPrefixDepth|commonPrefixDepth|isLegacyShape)\\b" src tests /home/agjrom/.claude/agents/lib/overmind.sh` -> zero matches.
- `getBySession()` intentionally remains: it is still used by `findWorkflow({ session })` for `/complete`, `/tasks`, `/children`, and pause/resume lookup compatibility.
- Remaining `/api/overmind/register` posts in `overmind.sh` are the primary attach-only register command path, not the removed child-sync fallback.

## Accumulated Time Decision

Do not migrate the legacy rollover into `registerAttached()`. Attach identity is project/run_dir; a normal attach re-register is a refresh of the same run, not a new session run. The dashboard Total display already computes `accumulated_ms + currentElapsed(run_started_at)`, so rolling elapsed into `accumulated_ms` on every attach re-register would double-count. B11 estimate-vs-actual should use the preserved run span/task transitions.

## Commits

- Final commit message: `feat(overmind): remove legacy register shape - attach-only registration (B3b, R1.1-R1.3)`

## Verification

- Shell syntax: PASS (`bash -n /home/agjrom/.claude/agents/lib/overmind.sh`)
- Type-check: PASS (`npx tsc --noEmit`)
- Full test suite: PASS (`npx vitest run`) - 39 files passed, 528 tests passed, 1 skipped.

## Caveats

- PRE-EXISTING: `/home/agjrom/.claude/agents/lib/overmind.sh` is outside the AGJAssist git repository, so it cannot be included in the repository commit. It was edited and validated in place.
