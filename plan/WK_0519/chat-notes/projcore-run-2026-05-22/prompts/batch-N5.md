Batch-N5: Cleanup — remove old notes plumbing (pure iPhone parity)

Branch: feat/chat-decommission-notes-ios · Req: R9 · NS-3
The iPhone Notes UI (N2–N4) + folder API (N1) are live. Now REMOVE the superseded old-model plumbing. Build + full suite must stay green (remove references together; update/delete affected tests).

User report (verbatim): "copy how the notes is working on iphone copy it 80-90% look and feel and functionality" → pure parity: status/tags/project-link/promote-to-plan are NOT part of iPhone Notes.

Acceptance criteria (R9):
1. BACKEND routes (src/api/routes/note-routes.ts): remove the plan/project note endpoints — POST /api/notes/add-to-plan, POST /api/notes/:id/promote, and GET+POST /api/projects/:projectId/notes. Keep the folder-model endpoints (note-folders CRUD, GET/POST/PATCH/DELETE /api/notes with folder_id/pinned/search). Simplify POST/PATCH /api/notes to the folder model (body, folder_id, pinned) — drop the title/tags/status/project_id params from the API surface (columns stay dormant in the DB; do NOT drop columns).
2. SERVICE (src/services/note-service.ts): remove addToPlan() and promote() methods and the now-unused old list()/listAll() filters for status/tags/project IF nothing else uses them (grep first; the old NotesPage is being removed in this batch). Keep the folder-model methods.
3. FRONTEND: remove the old NotesPage component (unrouted since N2) and the ProjectDetail NotesTab (project-scoped notes) + its sub-tab in ProjectDetail. The Notes feature is now folder-based only (the IosNotesPage at /notes). Ensure ProjectDetail still renders without the Notes tab.
4. TELEGRAM (src/bot/assistant-core.ts): adapt /note and /notes — `/note <text>` creates a note in the default "Notes" folder (drop the <project> arg); `/notes` lists recent notes from the default folder. Update the /help text + telegram-bot setMyCommands descriptions accordingly. (Keep the commands; just retarget them to the folder model.)
5. Update/remove any tests that reference the removed methods/routes (addToPlan/promote/project-notes). Do NOT weaken coverage of the folder model.
6. `npx tsc` + `npm run build` clean; `npx vitest run` green except the known Ollama conversation-memory failure.

Scope/DON'T:
- Do NOT drop any DB column or table (project_id/status/tags stay dormant).
- Do NOT touch chat/OVM, overmind, providers, or the N2/N3/N4 iPhone Notes UI behavior.
- Do NOT remove the plans feature or plan_notes table — only the note→plan PROMOTION path.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-N5/changes.md (Codex template + Verification: tsc/build PASS, vitest counts, list exactly what was removed + confirm no dangling references / dead imports).
- decisions/ entry if non-trivial, else "none."

Commit `[N5] remove old notes plumbing: add-to-plan/promote routes+methods, project-scoped notes, old NotesPage + ProjectDetail NotesTab; retarget TG /note to default folder (R9 pure parity)`. End with STATUS marker.
