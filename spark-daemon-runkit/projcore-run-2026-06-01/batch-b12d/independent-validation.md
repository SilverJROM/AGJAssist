# Batch B12d Independent Validation Notes

Implementer self-check before handoff:

- R12.2 POST create path exists at `/api/overmind/projects`.
- Owner JWT create returns `201` and project JSON.
- Caller-supplied `created_by` is ignored; persisted response has `created_by: "JROM"`.
- Duplicate `slug` returns `409`.
- Duplicate `app_path` returns `409`.
- Loopback plus overmind token, without owner JWT, returns `403 {"error":"projects are JROM-managed; ask JROM to create via dashboard"}`.
- Valid non-owner/viewer JWT returns the same `403` response.
- Missing auth returns `401`.
- Relative and missing `app_path` values return `400`.
- Service helpers create, list, read by slug, read by app_path, and count active runs.
- No GET/PATCH/DELETE project routes were added.

Independent projcore/validator gate still required before acceptance.
