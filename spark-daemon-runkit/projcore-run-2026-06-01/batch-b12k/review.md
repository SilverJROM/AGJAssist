# B12k Review

PASS self-review.

- Scope stayed inside B12k: project dashboard edit/delete/warning UI plus one minimal project GET read-shape field.
- PATCH/DELETE endpoint behavior remains the B12e owner-JWT-only implementation; no server mutation semantics were widened.
- `slug` and `app_path` are rendered as disabled fields in the edit modal and are never sent in the UI PATCH body.
- 409 delete guard uses the server error body through `api()`, does not remove the row, and was visually proven against an active-run project.
- Warning indicator uses `latest_parent_status` only; `bare-bash` and `no-session` render yellow, while `ok` does not.
