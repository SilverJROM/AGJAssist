# Batch B1 Changes

## Root mechanism

Agents previously had to infer the attach registration contract from source. The new describe endpoint makes Overmind publish that contract directly, using the same lifecycle auth gate as registration and reading valid projects from the live project registry.

## Files

- `src/api/routes/overmind-routes.ts`
  - Added `GET /api/overmind/register/describe`.
  - Reuses `requireLoopbackAndTokenCredential` with `config.overmind.token`, preserving loopback-only plus overmind-token auth.
  - Returns a versioned `{ ok: true, version: 1, register, projects }` envelope.
  - Documents the attach POST shape, required `run_dir` and `token`, forbidden derived identity fields, a JSON input schema, notes, and an example.
  - Builds `projects` from `overmindService.listProjects()` and exposes only `slug`, `app_path`, and `parent_session`.

- `tests/overmind-routes.test.ts`
  - Added route coverage for the 200 describe envelope.
  - Creates a project in the test database and asserts it appears in `projects[]`.
  - Asserts missing token returns 401 and non-loopback access returns 403.
