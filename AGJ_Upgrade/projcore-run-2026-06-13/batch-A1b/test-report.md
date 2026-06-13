# Batch A1b Test Report

## Commands

```sh
npx vitest run tests/unit/agent-assignment-service.spec.ts
```

Result: PASS

Evidence:
- `tests/unit/agent-assignment-service.spec.ts` passed 7 tests.
- New round-trip/import/idempotency test passed.

```sh
npm run build
```

Result: PASS

Evidence:
- `tsc -p tsconfig.json` completed successfully.
- `src/web` copied into `dist/` by the existing build script.

```sh
npm test
```

Result: FAIL, unrelated pre-existing branch expectation drift.

Evidence:
- A1b focused spec still passed inside the full run.
- 5 failures were stale schema-version assertions expecting `31` while the A1 branch schema is already `32`:
  - `tests/notes-folders.test.ts`
  - `tests/notes-migration.test.ts`
  - `tests/overmind-service.test.ts`
- No full-suite failure referenced the A1b export/import code path.

## Coverage Notes

- Round-trip coverage seeds multiple providers, role defaults, and project-specific bindings.
- Validation asserts resolved role source and agent name outcomes match the original DB after import.
- Idempotency coverage re-imports the same markdown and checks row counts remain stable.
