# Batch B12h Test Report

## PASS - Bash syntax

Command:

```bash
bash -n ~/.claude/agents/lib/overmind.sh
```

Result: PASS.

## PASS - Legacy flag rejection

Command:

```bash
OVERMIND_URL=http://127.0.0.1:9 OVERMIND_TOKEN_FILE=/tmp/no-token \
  ~/.claude/agents/lib/overmind.sh register --label x --run-dir /tmp/y
```

Result: exit `2`, stderr:

```text
[overmind] register: --label/--parent-label/--session are no longer accepted (project-owned). Use: overmind.sh register --run-dir <abs>
```

Because rejection happens before token lookup and before `post_json`, no POST path is reachable for these flags.

## PASS - 201 attach stores workflow_id

Harness: temporary run directory plus local stub HTTP server on `127.0.0.1:39101` returning:

```json
{"workflow_id":123,"workflow":{"id":123}}
```

Observed request body:

```json
{"run_dir":"/tmp/tmp.vNVdJXeIe0/run","token":"test-token"}
```

Observed state:

```json
{
  "workflow_id": 123,
  "last_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "last_sync_at": "2026-06-01T07:30:45+00:00"
}
```

Result: PASS.

## PASS - 404 writes REGISTER-REJECTED callback

Harness: temporary app directory with `.git`, run directory under it, and local stub HTTP server on `127.0.0.1:39102` returning:

```json
{"error":"no-project-for-run-dir"}
```

Observed callback:

```text
[overmind REGISTER-REJECTED] no-project-for-run-dir — JROM must create the project for /tmp/tmp.eVe0F23msw/app via the dashboard before this run can register. Suggested slug: app. Run: /tmp/tmp.eVe0F23msw/app/projcore-run-test.
```

Result: exit `1`, callback present, one POST with only `run_dir` and `token`. PASS.

## HARD GATE PASS - Register-only diff

Pre-edit snapshot: `/tmp/overmind-b12h-pre.sh`.

Boundary check:

```text
before-register-identical= True
after-register-identical= True
changed-region-pre-lines= 90
changed-region-cur-lines= 71
```

Per-function byte-identity check:

```text
cmd_sync: IDENTICAL
cmd_child_add: IDENTICAL
cmd_child_rm: IDENTICAL
cmd_complete: IDENTICAL
cmd_pause_resume: IDENTICAL
cmd_stall_alert: IDENTICAL
```

Result: PASS. The deployed live script differs only inside `cmd_register`.
