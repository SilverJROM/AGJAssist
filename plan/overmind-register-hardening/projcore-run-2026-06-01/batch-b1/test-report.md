# Batch B1 Test Report

## Assertions

- `GET /api/overmind/register/describe` with loopback plus `x-overmind-token` returns 200.
- The response is a parseable versioned envelope with `ok: true`, `version: 1`, a POST `/api/overmind/register` contract, required `run_dir` and `token`, forbidden derived fields, JSON input schema, notes, and example.
- A freshly created project appears in `projects[]` with `slug`, `app_path`, and `parent_session`.
- Missing overmind token returns 401.
- Non-loopback access with a valid token returns 403.

## Results

- `npx tsc --noEmit` passed.
- `npx vitest run tests/overmind-routes.test.ts` passed: 53 tests passed in 1 file.
