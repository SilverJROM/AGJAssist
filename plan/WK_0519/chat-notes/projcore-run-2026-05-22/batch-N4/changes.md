# Batch N4 — iPhone Notes folder management + pin/unpin affordance

## Summary
Frontend-only changes to `src/web/public/app.js` and `src/web/public/style.css`.
Adds folder CRUD (create/rename/delete), move-note-to-folder, and pin/unpin affordances
on top of N2/N3 work. No backend, no chat/OVM/overmind touched.

---

## Changes

### `src/web/public/app.js`

**IosNoteRow** (`function IosNoteRow`)
- Props extended: `onPin`, `onMove` (both optional).
- Swipe class changed from `swiped` → `swiped-actions` (new CSS; 3-button bar at 168px).
- Swipe actions bar rendered as `.ios-swipe-actions` containing three `.ios-swipe-action-btn` buttons:
  - **Pin / Unpin** (orange) → calls `onPin(note)` → PATCH `/api/notes/:id {pinned}`.
  - **Move** (grey) → calls `onMove(note)` → opens IosMoveFolderSheet → PATCH `/api/notes/:id {folder_id}`.
  - **Delete** (red) → calls `onDelete(note)` → DELETE `/api/notes/:id`.
- Pin indicator `📌` prepended to title when `note.pinned` is true.

**IosMoveFolderSheet** (new component)
- Bottom sheet modal listing all folders except the current one.
- Props: `note`, `folders`, `currentFolderId`, `onMove(note, targetFolder)`, `onClose`.
- Calls `onMove` on folder selection; "Cancel" dismisses.

**IosNotesList** (`function IosNotesList`)
- New props: `folders` (array), `onPinNote` (callback after pin — used to reload folder counts).
- Local state: `moveNote` (note being moved; null = hidden sheet).
- `handlePin(note)` → PATCH `/api/notes/:id {pinned: !note.pinned}` → reload list; calls `onPinNote()`.
- `handleMoveConfirm(note, targetFolder)` → PATCH `/api/notes/:id {folder_id: targetFolder.id}` → reload list.
- IosNoteRow receives `onPin={handlePin}` and `onMove={(note) => setMoveNote(note)}` (only if `folders.length > 1`).
- IosMoveFolderSheet rendered at bottom of screen when `moveNote` is set.

**IosNoteEditor** (`function IosNoteEditor`)
- New props: `folders` (array), `onMoveNote` (callback post-move).
- New state: `showMoveSheet` (boolean).
- Editor actions header: pin toggle (existing) + 📂 "Move" button (shown when ≥1 other folder exists) + delete (existing).
- `handleMoveToFolder(targetFolder)` → flush pending save → PATCH `/api/notes/:id {folder_id}` → calls `onReload()` + `onMoveNote()` → navigates back.
- IosMoveFolderSheet rendered in editor when `showMoveSheet` is true.

**IosNotesPage** (`function IosNotesPage`)
- New state: `editMode` (boolean, default false).
- Folders header is now a flex row with title left, actions right: **Edit/Done toggle** + **New Folder** (📁+) button.
- Folder row in edit mode shows:
  - Red circle **–** delete button (calls `handleDeleteFolder`; disabled/greyed for `is_default` folders).
  - **Rename** inline button (calls `handleRenameFolder`; skipped for `is_default`).
  - Chevron hidden in edit mode.
- "New Folder" row at bottom of list (outside edit mode) as secondary affordance.
- `handleCreateFolder()` → `window.prompt('Folder name:')` → POST `/api/note-folders {name}` → reload.
- `handleRenameFolder(f)` → guard: `is_default` → alert + return; else `window.prompt('Rename folder:', f.name)` → PATCH `/api/note-folders/:id {name}` → reload.
- `handleDeleteFolder(f)` → guard: `is_default` → alert + return; else `confirm(...)` → DELETE `/api/note-folders/:id` → reload; catches 4xx from API (default-folder guard on server) with graceful alert.
- IosNotesList receives `folders={folders}` and `onPinNote={loadFolders}`.
- IosNoteEditor receives `folders={folders}`.

### `src/web/public/style.css`

- Removed old standalone `.ios-swipe-delete-btn` absolute-positioned rule (replaced by new system).
- Added N4 section (bottom of file):
  - `.ios-folders-header--row` — flex row for folders title + actions.
  - `.ios-folder-edit-toggle`, `.ios-folder-new-btn`, `.ios-folder-new-icon` — Edit/Done and New Folder header buttons.
  - `.ios-folder-row--edit` — cursor: default in edit mode.
  - `.ios-folder-delete-circle` (red, 22px circle), `.ios-folder-delete-circle--disabled` (greyed for default).
  - `.ios-folder-rename-btn` — small bordered inline rename button.
  - `.ios-folder-new-row` — "New Folder" affordance row below list.
  - `.ios-note-row.swiped-actions { transform: translateX(-168px) }` — 3-button swipe width.
  - `.ios-swipe-actions` — absolute-positioned flex container (168px wide, right-aligned).
  - `.ios-swipe-action-btn`, `.ios-swipe-pin-btn` (orange), `.ios-swipe-move-btn` (grey), `.ios-swipe-delete-btn` (red).
  - `.ios-pin-indicator` — small pin emoji prefix.
  - `.ios-sheet-backdrop`, `.ios-sheet`, `.ios-sheet-handle`, `.ios-sheet-title`, `.ios-sheet-list`, `.ios-sheet-empty`, `.ios-sheet-row`, `.ios-sheet-row-name`, `.ios-sheet-cancel` — bottom sheet modal.

---

## Endpoints used
| Flow | Method + Endpoint | Body |
|------|------------------|------|
| Create folder | POST `/api/note-folders` | `{name}` |
| Rename folder | PATCH `/api/note-folders/:id` | `{name}` |
| Delete folder | DELETE `/api/note-folders/:id` | — |
| Move note | PATCH `/api/notes/:id` | `{folder_id}` |
| Pin/Unpin note | PATCH `/api/notes/:id` | `{pinned}` |

---

## Default-folder protection
- **is_default** field on folder objects drives the UI guard.
- Rename: if `f.is_default` is truthy → alert "cannot rename" + return (no API call).
- Delete: if `f.is_default` is truthy → alert "cannot delete" + return (no API call). Additionally, if the backend returns 4xx anyway (server-side guard), the `catch` shows `e.message` gracefully.
- The default folder's delete circle is rendered in greyed/disabled style (`.ios-folder-delete-circle--disabled`).

## Delete-moves-to-default handling
- DELETE `/api/note-folders/:id` response is 200/204 on success; the backend moves the folder's notes to the default folder automatically.
- The UI calls `loadFolders()` after success, so the default folder's note_count updates on the folders screen.

---

## Verification
- `npx tsc`: PASS (no output)
- `npm run build`: PASS (`tsc -p tsconfig.json && cp -r src/web dist/` — clean)
- No console errors introduced (new code uses same patterns as N2/N3: `useState`, `useCallback`, `useRef`, `api()`).

---

## Decisions
- **Default folder rename/delete protection**: guarded in UI (`is_default` check) before any API call, matching iPhone behavior (default "Notes" folder is unmovable/undeletable). API also enforces this server-side (4xx). Both layers protect.
- **Edit mode vs swipe for folder management**: chose Edit mode toggle (iOS 16+ pattern) because it cleanly separates browsing from management, works well on desktop, and avoids needing a full swipe system on folder rows. Folder rows don't need swipe because they're less frequent management targets than note rows.
- **Swipe width expanded to 168px** (3 × 56px) for 3 note-row actions. Old `.swiped` class (76px) kept in CSS as dead-code comment for safety.
- **Move from editor**: after a move, editor calls `onBack()` so the user lands back on the list (which was the source folder). The source-folder list then reloads, showing the note absent. This matches iPhone behavior.
