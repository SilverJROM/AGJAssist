# Batch B12h Scenarios

## TS-B12H-001 - Legacy identity flags rejected before POST

Given `overmind.sh register` is called with `--label`, `--parent-label`, or `--session`
When the command is run
Then it exits non-zero, prints the documented project-owned-register error to stderr, and does not POST to the server.

## TS-B12H-002 - Canonical run-dir attach stores workflow_id

Given a valid run directory and an overmind server returning HTTP 201 with `workflow_id`
When `overmind.sh register --run-dir <abs>` is run
Then the client sends only `run_dir` and `token`, stores `workflow_id` in `.overmind-state.json`, and logs `register OK`.

## TS-B12H-003 - No project 404 writes callbacks rejection

Given a valid run directory and an overmind server returning HTTP 404 `no-project-for-run-dir`
When `overmind.sh register --run-dir <abs>` is run
Then the client appends `[overmind REGISTER-REJECTED] no-project-for-run-dir ...` to `<run-dir>/callbacks.md`, logs the rejection, and exits non-zero.

## TS-B12H-004 - Live coordinator verbs remain unchanged

Given the pre-edit live script snapshot
When the deployed script is compared after the B12h edit
Then only the `cmd_register` region differs; `cmd_sync`, `cmd_complete`, `cmd_child_add`, `cmd_child_rm`, `cmd_pause_resume`, and `cmd_stall_alert` are byte-identical.
