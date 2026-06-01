# Batch B2 Test Report

## Commands

```text
npm test -- --run tests/overmind-routes.test.ts -t "active runs"
```

Result: PASS

```text
Test Files  1 passed (1)
Tests       2 passed | 49 skipped (51)
```

```text
npm run build
```

Result: PASS

```text
npm test -- --run tests/overmind-routes.test.ts
```

Result: PASS

```text
Test Files  1 passed (1)
Tests       51 passed (51)
```

## Coverage Notes

- Empty registry returns `{"runs":[]}`.
- Project-backed active workflow returns the R7.1 shape with `parent_session`.
- Completed and paused workflows are excluded.
- Legacy active workflow with `project_id NULL` is excluded.
- Child session/role arrays are parsed into objects.
- Dispatch manifest listing includes sorted `.json` files only.
- Missing token returns `401`; non-loopback token request returns `403`.

