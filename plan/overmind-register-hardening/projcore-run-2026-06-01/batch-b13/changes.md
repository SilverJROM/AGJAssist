# Batch B13 Changes

## Branch: `feat/ovm-register-hardening`

Cut from `feat/ovm-register-hardening` @ `c432ceabe2bc4b3fad46632d98752aeb51819b17`.

## User Report

"Make the MCP foolproof so agents get NO issues logging their work and having it monitored."

## Root Cause

Feature: expand the agent-facing Overmind lifecycle primer and turn `overmind.sh self-test` from a dry diagnostic into a read-only registration/monitoring health report.

## Code Changes

- `plan/overmind/REGISTRATION.md` - Expanded the canonical agent doc from register-only notes into the full discover/register/tasks/children/complete/monitoring/errors/self-test lifecycle.
- `/home/agjrom/.claude/agents/lib/overmind.sh` - Added token-authenticated read-only discovery helpers and replaced `cmd_self_test` with six PASS/FAIL health checks for token, project match, registration, child roster, task validity, and monitoring expectations. This target is outside the AGJAssist git repo.
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b13/changes.md` - Recorded scoped implementation details.
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b13/test-report.md` - Captured acceptance command outputs.

## Commits

- `feat(overmind): full agent operations primer + comprehensive self-test (B13, R15.5)`

## Standing Rules

- Future Overmind agent lifecycle changes should update `plan/overmind/REGISTRATION.md` as the canonical agent-facing primer.
- `overmind.sh self-test` must remain read-only; use lifecycle endpoints only through GET discovery/active-run reads during self-test.

## Verification

- Syntax: PASS (`bash -n /home/agjrom/.claude/agents/lib/overmind.sh`)
- Healthy self-test: PASS (`/home/agjrom/.claude/agents/lib/overmind.sh self-test --run-dir /home/agjrom/TGBOTS/AGJAssist/plan/overmind-register-hardening/projcore-run-2026-06-01`, exit 0)
- No-project self-test: PASS (`/home/agjrom/.claude/agents/lib/overmind.sh self-test --run-dir /tmp/no-project`, printed no-project failure and exit 1)
- App build: not run; this batch touched docs and shell helper only.

## Caveats

- PRE-EXISTING: The required `overmind.sh` file lives at `/home/agjrom/.claude/agents/lib/overmind.sh`, outside this repository, so the repository commit can include the primer and batch artifacts but not that script file.
