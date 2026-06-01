# B12o Scenarios

- T12.1: owner JWT creates an overmind project with `201`; duplicate slug and duplicate `app_path` each return `409`.
- T12.2: project creation without owner auth returns `401` for no auth, `403` for viewer JWT, and `403` for loopback overmind token only.
- T12.3: run-dir-only register under a project `app_path` ancestor returns `201` with `workflow_id`, `project_slug`, `parent_session`, and persisted project linkage.
- T12.4: run-dir-only register with no matching project returns `404 no-project-for-run-dir` with `hint` and `searched_up_to`; `overmind.sh register` against a stubbed `404` appends `[overmind REGISTER-REJECTED]` to the run callbacks.
- T12.5: run-dir-only attach rejects caller-supplied derived fields `label`, `parent_session`, and `session` with `422 forbidden-derived-field`.
