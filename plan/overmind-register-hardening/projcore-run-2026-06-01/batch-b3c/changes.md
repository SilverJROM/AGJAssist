# Batch B3c Changes

## Branch: `feat/ovm-register-hardening`

Cut from existing branch state for `batch-b3c`.

## User Report

"Prove, with an end-to-end test, that a fresh agent has a SEAMLESS registration experience — \"no repeat of today's issues\" (JROM)."

## Root Cause

Feature acceptance proof: one in-process registration journey now composes describe, attach registration, child roster update, watcher stale-gap suppression, corrective register errors, and task-list rejection.

## Code Changes

- `tests/overmind-registration-journey.test.ts` — Added a six-step Fastify in-process journey test covering R14's full Phase-1 registration surface.
- `plan/overmind/REGISTRATION.md` — Added a concise agent primer for attach-only registration, corrective errors, and child registration.

## Commits

- `test(overmind): seamless registration journey capstone + agent primer (B3c, R14)` | scenarios: R14 steps 1-6

## Standing Rules

- Fresh agents must use attach-only registration; identity fields are project-derived and must not be submitted by clients.

## Verification

- Type-check: PASS (`npx tsc --noEmit`)
- Targeted tests: PASS (`npx vitest run tests/overmind-registration-journey.test.ts tests/overmind-routes.test.ts`) — 2 files / 52 tests.
- Full tests: PASS (`npx vitest run`) — 40 files / 529 passed / 1 skipped.

## Caveats

- None.
