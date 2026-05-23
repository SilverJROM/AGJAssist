# Decision: Include `.test.ts` Files In Vitest

## Context

Batch A1 explicitly requires the test file `tests/overmind-service.test.ts` and the gate command:

```text
npx vitest run tests/overmind-service.test.ts
```

The repository's `vitest.config.ts` only included `tests/**/*.spec.ts`, so the required command could not discover the required file.

## Decision

Add `tests/**/*.test.ts` to the Vitest include list alongside the existing `tests/**/*.spec.ts`.

## Impact

The required A1 test command now runs normally. Runtime code is unaffected.
