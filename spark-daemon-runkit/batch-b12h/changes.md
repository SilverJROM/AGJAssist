# Batch B12h Changes

## User Report

`overmind.sh CLIENT: register --run-dir only + 404 REJECTED callback`. Critical scope guard: edit the live `~/.claude/agents/lib/overmind.sh` that supervising projcore is using right now; touch only the `register` verb; keep `sync`/`complete`/`child-add`/`child-rm`/`stall-alert`/`pause`/`resume` exactly as-is; `bash -n` must stay clean.

## Root Cause

`cmd_register` still built the legacy self-registration payload from caller-owned `label`, `session`, `parent_label`, children, current task, and task list. R12.5 moved project ownership to the dashboard/server model, so the client needed to attach by `run_dir` only and reject old project identity flags before any network call.

## Files Changed

- `~/.claude/agents/lib/overmind.sh` (live, outside git): rewrote only `cmd_register` to accept `--run-dir`, reject legacy identity flags, send `{run_dir, token}`, store `workflow_id`, and write the 404 REGISTER-REJECTED callback.
- `spark-daemon-runkit/batch-b12h/artifacts/overmind.sh`: reference snapshot of the deployed live script.
- `spark-daemon-runkit/batch-b12h/*`: batch evidence artifacts.

## Behavior Notes

- Legacy `--label`, `--parent-label`, and `--session` now exit `2` with the required stderr message before run-dir resolution or token lookup.
- HTTP 404 is not retried. It writes the rejection callback and exits `1`.
- Other non-2xx responses preserve the existing best-effort behavior: retry once, log failure, and continue without failing the run.
- Autonomous decisions: see `decisions/2026-06-01-app-path-guess.md`.
