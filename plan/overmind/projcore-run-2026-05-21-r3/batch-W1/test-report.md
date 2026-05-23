# W1 Test Report

Commands run:

```sh
npx vitest run tests/overmind-brain.test.ts tests/overmind-decision.test.ts tests/overmind-nudge.test.ts tests/overmind-notifications.test.ts tests/overmind-service.test.ts
npx tsc --noEmit
npm run build
```

Results:

- Targeted Vitest: PASS, 5 files / 29 tests.
- TypeScript no-emit: PASS.
- Build: PASS.

Note: the targeted suite intentionally emits stderr for the fake brain-failure test while asserting the fallback path.

