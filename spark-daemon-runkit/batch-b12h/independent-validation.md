# Batch B12h Independent Validation

Validated against deployed live file `~/.claude/agents/lib/overmind.sh` and reference snapshot `spark-daemon-runkit/batch-b12h/artifacts/overmind.sh`.

## Results

- `bash -n ~/.claude/agents/lib/overmind.sh`: PASS.
- Legacy flag rejection: PASS, exit `2` with the documented stderr message.
- Stubbed HTTP 201 attach: PASS, request body contained only `run_dir` and `token`; `.overmind-state.json` stored `workflow_id: 123`.
- Stubbed HTTP 404 no-project: PASS, callback line appended to `<run-dir>/callbacks.md`; command exited `1`.
- Scope guard: PASS, only `cmd_register` changed; `cmd_sync`, `cmd_child_add`, `cmd_child_rm`, `cmd_complete`, `cmd_pause_resume`, and `cmd_stall_alert` are byte-identical to `/tmp/overmind-b12h-pre.sh`.

## Verdict

PASS. R12.5 client-side register behavior is implemented and the live coordinator verbs outside register were not changed.
