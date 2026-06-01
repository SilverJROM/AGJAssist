# B12k Scenarios

Scope: R12.6b dashboard Overmind Projects edit, delete, and warning indicator.

- Edit modal: an owner opens Edit from a project row, sees `slug` and `app_path` as immutable fields, changes only `parent_session` and `notes`, saves through `PATCH /api/overmind/projects/:slug`, and sees the refreshed row.
- Delete success: an owner confirms Delete for a project with zero active runs, `DELETE /api/overmind/projects/:slug` returns 200, and the row is removed from the list.
- Delete guard: an owner confirms Delete for a project with active runs, the 409 server message is surfaced, and the row remains.
- Warning indicator: a project whose most-recently-updated attached workflow has `parent_status` of `bare-bash` or `no-session` shows a yellow parent warning; a project with `latest_parent_status='ok'` does not.
