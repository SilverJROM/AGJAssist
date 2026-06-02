# Overmind Agent Operations

Agents attach to Overmind through the JROM-owned project model. Use this as the canonical lifecycle primer for logging and monitoring a run.

## Discover

1. Read the full lifecycle contract first:
   `curl -s -H "x-overmind-token:$OVERMIND_TOKEN" http://127.0.0.1:3101/api/overmind/describe`
2. `/api/overmind/describe` returns `version: 2`, endpoint schemas, examples, and live `projects`.
3. For registration-only help:
   `curl -s -H "x-overmind-token:$OVERMIND_TOKEN" http://127.0.0.1:3101/api/overmind/register/describe`
4. `/register/describe` lists the attach-only register schema and the valid project `slug`, `app_path`, and `parent_session` values.

## Register

5. Register once at run start:
   `overmind.sh register --run-dir <abs>`
6. The register payload is only `{ "run_dir": "<absolute path>", "token": "<OVERMIND_TOKEN>" }`.
7. Never send `label`, `session`, `parent_session`, `parent_label`, or `project_slug`.
8. Overmind derives identity from the JROM-owned project whose `app_path` contains `run_dir`.
9. A successful register returns `201` with `workflow_id`, `project_id`, `project_slug`, and `parent_session`.
10. `workflow.coordinator_session` must match the matched project's `parent_session`; it should not be `null`.
11. Keep the same absolute `run_dir` for every later lifecycle command.

## Report Tasks

12. Maintain real task rows in `queue.md`; use meaningful IDs like `B13`, `batch-b13`, or `R15`.
13. Run `overmind.sh sync --run-dir <abs>` when queue/progress/artifacts changed.
14. `sync` hashes filesystem evidence and only posts `/api/overmind/tasks` when real work changed.
15. Task shape is `{id,label,state}` with `state` exactly `done`, `processing`, or `pending`.
16. Labels must be non-empty, <=120 characters, and task-sized, not paragraphs.
17. Do not send markdown table chrome or parser fallback IDs like `row-1`; skip unparseable rows instead.
18. The dashboard and `/om_tasks` read this list, so stale or garbage tasks make monitoring worse.

## Children

19. Add each live implementer/validator pane after the parent is attached:
   `overmind.sh child-add <session> <role> --run-dir <abs>`
20. Remove closed or reassigned children:
   `overmind.sh child-rm <session> --run-dir <abs>`
21. Child commands update the roster through `/api/overmind/children`; they do not create a new workflow.
22. Child session names must be tmux-safe: letters, digits, dots, underscores, and dashes.

## Complete

23. Before hand-back, mark the lifecycle complete:
   `overmind.sh complete --run-dir <abs>`
24. Complete addresses the workflow by cached `workflow_id` and `run_dir`, sends `/api/overmind/complete`, and emits the done transition once.
25. If unfinished tasks remain, Overmind can remind the parent to mark them done before treating the run as truly closed.

## Monitoring

26. The watcher ticks active workflows, captures parent/child panes, reads run artifacts, and updates status.
27. Projcore should also keep its watcher running and use a ScheduleWakeup fallback when appropriate.
28. A nudge means Overmind sees apparent idleness, missing registration data, or a completion/reporting gap.
29. Healthy active work is not nagged: recent `progress.md`, `callbacks.md`, `queue.md`, git-head activity, active panes, or in-flight subagents suppress idle asks.
30. Nudges go to the coordinator, not child sessions; child panes are watched for status and roster health.

## Errors

31. Lifecycle endpoint failures use a uniform envelope: `{ok:false, code, message, hint}`.
32. Read `hint` first; it states the next correction.
33. `no-project-for-run-dir`: the path is not under any registered project; use a listed project path or ask JROM to create one.
34. `legacy-register-removed`: retry register with only `{run_dir, token}`.
35. `forbidden-derived-field`: remove derived identity fields such as `label` or `session`.
36. `invalid-task-list`: rebuild tasks with real IDs, short labels, and valid states; no `row-N` garbage.
37. `invalid-session-name`: use only tmux-safe session names, max length 80.

## Self-Test

38. Verify a run before relying on monitoring:
   `overmind.sh self-test --run-dir <abs>`
39. The self-test is read-only and checks token access, project match, registration cache/live active-run visibility, child roster liveness, task-list validity, and monitoring expectations.
40. It exits `0` when critical checks pass and non-zero when setup is not monitorable.
