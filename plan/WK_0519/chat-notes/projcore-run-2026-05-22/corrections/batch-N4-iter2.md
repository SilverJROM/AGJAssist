# Correction — Batch N4, iter 2

Gate failed: §1.10 gate-5 (evidence quality, R5 folder protection). The UI gates the default-"Notes"-folder rename/delete protection on `folder.is_default` (app.js ~3137, 3147, 3209, 3215, 3221), but the folders API does NOT return that field — GET /api/note-folders returns `{id,name,position,created_by,created_at,updated_at}` only. So `is_default` is always undefined → the default folder is NOT protected in the UI (rename/delete affordances show for it; only the server-side delete-guard catches deletion). tsc passed because it's an untyped runtime access.

## Fix (small, ONLY this)
1. BACKEND: make the folders list response include `is_default: boolean` — true when the folder's id === NoteService.defaultFolderId(). Do it in NoteService.listFolders() (add the computed flag to each returned folder; extend the NoteFolder interface with `is_default: boolean`) OR in the GET /api/note-folders route handler. Pick the service so it's consistent everywhere.
2. ALSO guard RENAME server-side for parity with delete: renameFolder should refuse to rename the default folder (return null / the route returns 4xx), mirroring deleteFolder's default-folder guard. (Defense-in-depth; the UI also blocks it.)
3. Verify the UI now actually protects the default folder: in edit mode the default "Notes" folder shows NO rename/delete affordance (or they're disabled), and attempts are blocked. Other folders still rename/delete/move/pin fine.
4. `npx tsc` + `npx vitest run` (green except known Ollama). Add/extend a test asserting listFolders flags the default folder is_default=true and others false.

## Don't re-do
- Keep all the N4 UI flows (create/rename/delete/move/pin, edit mode, swipe, move-sheet) — only wire the is_default truth from the backend + the rename server-guard.
- Frontend + the note-service/route only. Do NOT touch chat/OVM/overmind/providers or the N2/N3 list/editor behavior.

Commit `[N4] add is_default flag to folders API + server-guard rename of default folder (fix UI default-folder protection)`. End with STATUS marker.
