# Batch B2 Test Report

- `npx tsc --noEmit` — PASS
- `npx vitest run tests/overmind-routes.test.ts` — PASS

Targeted coverage:
- `404 no-project-for-run-dir` returns `ok:false`, `code`, `message`, a run-dir-specific corrective `hint`, and live `validProjects`.
- `422 forbidden-derived-field` returns `ok:false`, `code:"forbidden-derived-field"`, `message`, `hint`, and preserves `error` plus `field`.
