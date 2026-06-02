# Batch B12 Test Report

## Commands

- `npx vitest run tests/overmind-sanitize.test.ts tests/overmind-routes.test.ts tests/overmind-registration-journey.test.ts`
- `npx vitest run`
- `npx tsc --noEmit`

## Results

- Focused Vitest: PASS
  - 3 test files passed
  - 55 tests passed
- Full Vitest: PASS
  - 40 test files passed
  - 536 tests passed
  - 1 test skipped
- TypeScript: PASS

## Acceptance Coverage

- Discovery returns `register`, `tasks`, `children`, `complete`, `pause`, and `resume` endpoint contracts with schemas/examples plus live projects.
- `/api/overmind/register/describe` remains backward-compatible and also exposes the full endpoint list.
- `/complete`, `/tasks`, `/children`, `/pause`, and `/resume` client-error paths return `{ok:false,error,code,message,hint}`.
- `/api/overmind/tasks` rejects a 121-character label with `invalid-task-list` and accepts a 120-character label.
- `validateSubmittedTaskList()` rejects overlong labels for both `/tasks` and attach-shaped `/register` callers.
