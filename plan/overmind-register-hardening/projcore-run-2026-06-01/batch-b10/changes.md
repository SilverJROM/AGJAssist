# Batch B10 Changes

## Branch: `feat/ovm-register-hardening`

Cut from `feat/ovm-register-hardening` @ `8a711ce`.

## User Report

"Each task carries an optional `estimate_min` (minutes). It flows from queue.md -> the client parser -> the tasks JSON -> the server, stored per task."

## Root Cause

Feature: per-task estimates needed to land in the queue parser, the task schema/validator, and the JSON task persistence path without rejecting existing estimate-less task lists.

## Code Changes

- `/home/agjrom/.claude/agents/lib/overmind.sh` - Added `(est: 25m)` extraction in `build_tasks_json`; the estimate token is stripped from labels and emitted as `estimate_min` integer or `null`.
- `src/services/overmind/types.ts` - Added optional `estimate_min?: number | null` to `OvermindTask`.
- `src/services/overmind/sanitize.ts` - Added estimate normalization so positive integers persist and missing, invalid, or non-positive values become `null` without invalidating the task.
- `src/api/routes/overmind-routes.ts` - Added `estimate_min` to the task discovery schema and example.
- `tests/overmind-sanitize.test.ts` - Covered valid, missing, negative, and non-numeric estimate normalization.
- `tests/overmind-routes.test.ts` - Covered `/register` and `/tasks` round-trip of estimates plus estimate-less back-compat.
- `tests/overmind-service.test.ts` - Updated direct service expectations for normalized `estimate_min: null`.

## Commits

- See commit `feat(overmind): per-task estimate_min -- parser + schema + submission (B10, R12)`.

## Standing Rules

- Future Overmind task fields must be normalized in both `validateSubmittedTaskList` and `sanitizeTaskList`, because tasks can enter through API routes and direct service calls.

## Verification

- Hardening: PASS (`./scripts/check-hardening.sh --files ...` unavailable; repo has no hardening script).
- Shell syntax: PASS (`bash -n ~/.claude/agents/lib/overmind.sh`).
- Parser smoke: PASS (temporary `queue.md` with `(est: 25m)`, missing estimate, non-numeric estimate, and zero estimate).
- Type-check: PASS (`npx tsc --noEmit`).
- Focused tests: PASS (`npx vitest run tests/overmind-sanitize.test.ts tests/overmind-routes.test.ts tests/overmind-service.test.ts`) - 94 passed.
- Full suite: PASS (`npx vitest run`) - 40 files passed, 542 passed, 1 skipped.

## Bug Reproductions

- Not applicable; feature batch.

## Caveats

- [PRE-EXISTING] `/home/agjrom/.claude/agents/lib/overmind.sh` is outside the AGJAssist git worktree and `/home/agjrom/.claude` is not a git repository. The parser edit was applied in place and verified, but cannot be included in the AGJAssist commit.
