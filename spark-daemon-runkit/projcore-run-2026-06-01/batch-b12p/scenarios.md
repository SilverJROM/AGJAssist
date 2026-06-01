# Batch B12p Scenarios

## T12.6 Dashboard Create Proof
- Use the same owner-JWT `POST /api/overmind/projects` path wired from the OVM Projects dashboard create modal.
- Assert `201`, follow-up `GET /api/overmind/projects` includes the created row, and `overmind_projects` service/DB lookup returns the persisted row.
- Browser modality is covered by B12j screenshots; this batch intentionally uses API-path + DB proof.

## T12.7 Delete Guard
- Seed an Overmind project and register an active run under it.
- Owner DELETE returns `409` with `active_runs: 1`; the project row remains and active count stays `1`.
- Mark the workflow completed, retry DELETE, assert `200 { ok: true }`, project row gone, and active count `0`.

## T12.8 Bare-Bash Parent Warning
- Mock `isAgentPane(parent_session)` to return `bare-bash`.
- Register a run under a matching project with run_dir-only payload.
- Assert `201`, `parent_status: bare-bash`, `parent_warning.code: parent-session-bare-bash`, and persisted workflow `parent_status: bare-bash`.
