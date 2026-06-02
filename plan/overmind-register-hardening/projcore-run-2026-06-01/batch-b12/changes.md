# Batch B12 Changes

## Branch: `feat/ovm-register-hardening`

Cut from `feat/ovm-register-hardening` @ `9823f78`.

## User Report

"Make the MCP foolproof so agents get NO issues logging their work and having it monitored."

## Root Cause

Feature batch: the Overmind lifecycle API now exposes the full implemented agent-facing contract, returns corrective client-error envelopes on lifecycle mutations, and rejects paragraph-length task labels at validation.

## Code Changes

- `src/api/routes/overmind-routes.ts` - Added canonical `GET /api/overmind/describe` with endpoint schemas/examples and live projects; kept `/api/overmind/register/describe` compatible.
- `src/api/routes/overmind-routes.ts` - Added `sendAgentClientError()` and applied `{ok:false,error,code,message,hint}` to register/tasks/children/complete/pause/resume client-error branches.
- `src/services/overmind/sanitize.ts` - Added `MAX_TASK_LABEL_LENGTH = 120` and rejects submitted task labels longer than 120 characters.
- `tests/overmind-routes.test.ts` - Added discovery, lifecycle envelope, and 120/121-character task-label coverage.
- `tests/overmind-sanitize.test.ts` - Added sanitizer coverage for task-label length validation.

## Commits

- `feat(overmind): full OVM discovery + uniform error envelopes + label-length validation (B12, R15.1-R15.3)`

## Standing Rules

- Agent-facing lifecycle routes should preserve legacy `error` values while adding the corrective envelope fields.

## Verification

- Type-check: PASS (`npx tsc --noEmit`)
- Full suite: PASS (`npx vitest run`) - 40 files passed, 536 tests passed, 1 skipped
- Focused suite: PASS (`npx vitest run tests/overmind-sanitize.test.ts tests/overmind-routes.test.ts tests/overmind-registration-journey.test.ts`) - 55 tests passed
- API smoke coverage: Vitest route tests assert `GET /api/overmind/describe`, `/complete` bad lookup, `/tasks` missing tasks and label length, `/children` missing children, and `/workflows/:id/pause|resume` bad auth/unknown workflow envelopes.

## Caveats

- PRE-EXISTING: `./scripts/check-hardening.sh` is not present in this repo, so the hardened-module precheck could not run.
