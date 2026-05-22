Batch-N3: iPhone Notes RICH EDITOR (replace the N2 textarea stub)

Branch: feat/chat-decommission-notes-ios · Req: R7 · NS-3/NS-4
Frontend. Replace the IosNoteEditor textarea stub (built in N2) with a rich contenteditable editor that mirrors iPhone Notes editing. Keep the existing auto-save + pin + delete + back wiring.

User report (verbatim): "redesign the notes function on the app and copy how the notes is working on iphone copy it 80-90% look and feel and functionality" — PURE iPhone parity (rich text + checklists).

Read first: the IosNoteEditor (and IosNotesList/IosNotesPage) in src/web/public/app.js (built in N2), and the notes API (PATCH /api/notes/:id { body }). body is stored as rich HTML.

Acceptance criteria (R7):
1. Rich contenteditable editor (replace the textarea). The note `body` is rich HTML. On load, render the stored HTML; on edit, auto-save the HTML (debounced PATCH /api/notes/:id { body }) — keep the existing debounce + flush-on-back behavior.
2. Formatting (iPhone Notes set, the 80-90%):
   - Bold / Italic (and underline if easy).
   - Headings: a Title/Heading/Body style (at least one heading level distinct from body).
   - Bulleted list.
   - Tappable CHECKLISTS: a checklist item with a tappable circle/check that toggles done (done item gets a check + strikethrough/dimmed). This is the signature iPhone feature — make it work on tap (touch + click).
3. A compact formatting toolbar (iOS-style accessory bar above the keyboard / at the bottom of the editor, or a top bar): buttons for the above (B, I, heading, bullet list, checklist). Use document.execCommand or a small manual implementation — whatever is robust in this Preact/htm no-build setup. Toggling reflects current selection state where feasible.
4. FIRST LINE = TITLE: the first line renders larger/bold (the title), like iPhone. No separate title field. The list preview (N2) already derives the title from the first line — keep that working (HTML-stripped first line).
5. Auto-save robustness: typing auto-saves the HTML; navigating back flushes; no data loss. Empty notes (no text) on back: match iPhone (discard empty new notes) OR keep — pick the iPhone behavior (discard a brand-new note left empty) and note it.
6. Build green (`npx tsc` + `npm run build`); no console errors; works on touch (TG mini-app) + desktop.

iOS feel: clean white editor, generous line spacing, the checklist circles and title styling should read like iPhone Notes.

Scope/DON'T:
- Frontend only (app.js + style.css). Do NOT touch backend, the notes API, chat/OVM, overmind, providers.
- Do NOT change the folders screen / list / search / swipe-delete from N2 beyond what's needed to open the new editor.
- Folder management UI (create/rename/delete, move-to-folder) is N4 — not here.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-N3/changes.md (Codex template + Verification: tsc/build PASS; describe the editor + each formatting control + how checklists toggle + how HTML round-trips through auto-save; note the empty-note behavior).
- decisions/ entry for any non-trivial UI call (e.g. execCommand vs manual, empty-note discard), else "none."

Commit `[N3] iPhone Notes rich editor: bold/italic/headings, bullets, tappable checklists, first-line title, HTML auto-save`. End with STATUS marker.
