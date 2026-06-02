# Overmind Registration

Agents attach to Overmind through the JROM-owned project model.

1. Discover the current contract:
   `GET /api/overmind/register/describe`

2. Register with the attach-only client command:
   `overmind.sh register --run-dir <abs>`

3. The request shape is only:
   `{ "run_dir": "<absolute path>", "token": "<OVERMIND_TOKEN>" }`

4. Never send `label`, `session`, `parent_session`, or `project_slug`.
   Overmind derives those from the project whose `app_path` contains `run_dir`.

5. A successful register returns `201` with `workflow_id`, `project_id`,
   `project_slug`, and the derived `parent_session`.

6. `workflow.coordinator_session` must match the project's `parent_session`.
   It should never be `null` for an attached run.

7. If register returns `404 no-project-for-run-dir`, the run directory is not
   under a registered Overmind project. Use one of the returned `validProjects`
   or ask JROM to create the missing project, then register again.

8. If register returns `422 legacy-register-removed`, the payload used the old
   identity-sending shape. Call `/describe` and retry with only `run_dir`.

9. If register or task sync returns `422 invalid-task-list`, rebuild the task
   list with real task IDs and labels. Do not send parser fallback IDs like
   `row-1`.

10. Add child sessions after the parent workflow is attached:
    `overmind.sh child-add <session> <role> --run-dir <abs>`

11. Remove stale children with:
    `overmind.sh child-rm <session> --run-dir <abs>`

12. The child commands update the registered workflow roster; they do not create
    a new workflow.

13. Keep using the same absolute run directory for register, child updates,
    task updates, completion, and pause calls.

14. If in doubt, fetch `/api/overmind/register/describe` first and follow the
    live project list and hints returned by the server.
