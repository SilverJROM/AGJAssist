# B12o Independent Validation

Verdict: PASS

Validation path:

- Ran the new consolidated acceptance file with `npx vitest run tests/acceptance/overmind-projects-api.acceptance.test.ts`.
- Confirmed all 7 tests passed.
- Ran `npm run build`; TypeScript build passed.

Requirement checks:

- T12.1 PASS: owner create returns `201`; duplicate slug and duplicate `app_path` return `409`.
- T12.2 PASS: missing auth returns `401`; viewer JWT returns `403`; loopback overmind token only returns `403`.
- T12.3 PASS: attach register under a containing project returns `201` with derived `workflow_id`, `project_slug`, `parent_session`, and persisted project linkage.
- T12.4 PASS: server no-project attach returns `404 no-project-for-run-dir` with `hint` and `searched_up_to`; `overmind.sh register` against a local stubbed 404 appends `[overmind REGISTER-REJECTED]` to the run callbacks.
- T12.5 PASS: attach-derived `label`, `parent_session`, and `session` fields each return `422 forbidden-derived-field`.
