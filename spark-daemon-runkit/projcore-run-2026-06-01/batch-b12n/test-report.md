# Batch B12n Test Report

## Environment

- Server: `http://127.0.0.1:3101`
- Database: live configured AGJAssist database
- Branch: `feat/spark-daemon-b12n-agj`
- Token handling: owner JWT kept in shell variable only, one-hour expiry, temporary session deleted after use

## Results

| Check | Result | Evidence |
|---|---|---|
| Read-only unauthenticated project probe | PASS | `GET /api/overmind/projects` returned `401` |
| Read-only authenticated project probe | PASS | `GET /api/overmind/projects` with loopback token returned `200` |
| AGJ project create/verify | PASS | Project `id=4`, `slug=AGJ`, `app_path=/home/agjrom/TGBOTS/AGJAssist`, `parent_session=AGJ-51`, `created_by=JROM` |
| Disposable register attach | PASS | `POST /api/overmind/register` returned `201`, `workflow_id=13`, `project_slug=AGJ`, `parent_session=AGJ-51` |
| GET shows attached run during proof | PASS | `GET /api/overmind/projects/AGJ` showed `active_runs_count=1` |
| Cleanup throwaway workflow only | PASS | `DELETE /api/overmind/workflows/13` returned `200` |
| AGJ project remains after cleanup | PASS | `GET /api/overmind/projects/AGJ` showed project still present and `active_runs_count=0` |
| `wf=4` untouched by attach proof | PASS | Read-only DB check: `id=4`, `project_id=NULL`, live run_dir unchanged, `status=working` |
| Throwaway workflow removed | PASS | Read-only DB check: workflow `13` no longer exists |

## Sanitized Proof Output

```json
{
  "ok": true,
  "server": "http://127.0.0.1:3101",
  "project_action": "created",
  "project": {
    "id": 4,
    "slug": "AGJ",
    "app_path": "/home/agjrom/TGBOTS/AGJAssist",
    "parent_session": "AGJ-51",
    "active_runs_count_during_proof": 1
  },
  "disposable_register": {
    "http_status": 201,
    "workflow_id": 13,
    "project_slug": "AGJ",
    "parent_session": "AGJ-51",
    "parent_status": "ok",
    "run_dir": "/home/agjrom/TGBOTS/AGJAssist/tmp/b12n-20260601T112845Z",
    "status": "active"
  },
  "cleanup": {
    "workflow_delete_status": 200,
    "deleted_only_workflow_id": 13,
    "project_left_in_place": true,
    "active_runs_count_after_cleanup": 0
  },
  "live_safety": {
    "restarted_3101": false,
    "touched_wf4": false,
    "used_live_run_dir": false,
    "owner_jwt_written_to_file": false,
    "owner_session_deleted_after_use": true
  }
}
```

## Notes

No code tests were run because B12n made no production-code change. The required proof was a live API/database safety verification.
