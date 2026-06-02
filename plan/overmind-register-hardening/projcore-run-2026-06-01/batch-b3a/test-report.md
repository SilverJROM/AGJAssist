# Batch B3a Test Report

## Commands

- `npx tsc --noEmit` - PASS.
- `npx vitest run tests/overmind-service.test.ts tests/overmind-routes.test.ts` - PASS: 2 files, 85 tests.
- `npx vitest run tests/acceptance/overmind-projects-api.acceptance.test.ts` - PASS: 1 file, 10 tests.
- `npx vitest run tests/notes-folders.test.ts tests/notes-migration.test.ts tests/overmind-stream.test.ts tests/ovm-session.test.ts` - PASS: 4 files, 46 tests.
- `npx tsc --noEmit && npx vitest run` - PASS: 39 files, 527 tests passed, 1 skipped.

## Legacy Register Proof

AST proof for register call sites:

```text
tests/overmind-routes.test.ts: total register/service calls=23, legacy label+session route/direct service=0
tests/overmind-service.test.ts: total register/service calls=0, legacy label+session route/direct service=0
```

`grep -nE "session:" tests/overmind-routes.test.ts` still reports non-register uses. Remaining `session:` entries are project `parent_session`, expected response rows, `/tasks`, `/complete`, `/history`, and helper inputs. None are `/api/overmind/register` payloads with legacy `{label, session}` shape.

The only remaining `/api/overmind/register` payload containing `label` is the attach negative test for forbidden derived field handling; it intentionally omits `session` and is not legacy-shaped.
