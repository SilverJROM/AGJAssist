# Batch N2 — changes.md

## Summary
iOS-style Notes list UI: folders screen → notes list (previews, pinned section, iOS search bar, swipe-to-delete, new-note compose button) → minimal auto-save textarea editor stub. Wired as the /notes route in both TgApp and App; old NotesPage left in place but unrouted.

## Screens built

### 1. Folders screen (`IosNotesPage`)
Route: `/notes` (replaces old `NotesPage`).
- Large-title "Notes" header (iOS style, 28px bold).
- Lists all folders in a grouped card (`ios-list-group`), iOS chevron + folder icon + name + count.
- Tap → navigates into that folder's notes list.
- Endpoint: `GET /api/note-folders` → `[{id, name, note_count, ...}]`.

### 2. Notes list (`IosNotesList`)
Stacked inside `IosNotesPage` when a folder is selected.
- iOS nav header with back chevron (`‹ Folders`) and centred folder name title.
- iOS rounded search bar → `GET /api/notes?search=<q>` (debounced 300ms) or `GET /api/notes?folder_id=<id>` when blank.
- Pinned notes in a "Pinned" section group above a "Notes" section group.
- Each row (`IosNoteRow`): bold first line as title (HTML-stripped), grey one-line snippet, relative date (time-of-day if today, "Yesterday", weekday if <7 days, date otherwise).
- iOS-style inset dividers between rows.
- Note count footer bar.

### 3. Swipe-to-delete (`IosNoteRow`)
- Touch: swipe left ≥50px reveals red Delete button (translateX(-76px) slide).
- Desktop: right-click (contextmenu) toggles the delete reveal.
- Tap "Delete" → `DELETE /api/notes/:id` with `confirm()` guard, then reloads list.

### 4. New-note compose (`IosNotesList` → `handleNewNote`)
- Fixed bottom-right compose button (pencil icon, accent circle).
- `POST /api/notes {folder_id}` with empty body → opens the new note immediately in the editor.
- Endpoint: `POST /api/notes`.

### 5. Note editor stub (`IosNoteEditor`)
- Full-screen textarea (no chrome beyond the nav header).
- Auto-focused on open; cursor at end.
- Debounced auto-save every 800ms → `PATCH /api/notes/:id {body}`.
- Pin toggle → `PATCH /api/notes/:id {pinned: true/false}`.
- Delete → `DELETE /api/notes/:id` with confirm, then back to list.
- On back: flushes pending save synchronously before navigating.
- First line = title (textarea is single source of truth; no separate title field).
- Endpoint: `PATCH /api/notes/:id`, `DELETE /api/notes/:id`.

## Files Changed

### `src/web/public/app.js`
- **Added** `IosNotesPage`, `IosNotesList`, `IosNoteRow`, `IosNoteEditor` components (~320 lines).
- **Added** helper functions: `stripHtml`, `noteTitle`, `noteSnippet`, `relativeDate`.
- **Wired** `/notes` route → `IosNotesPage` in both `TgApp` and `App` (two one-line changes).
- Old `NotesPage` left in place, unrouted.

### `src/web/public/style.css`
- **Added** iOS Notes styles (~250 lines): `ios-notes-screen`, `ios-folders-header`, `ios-notes-header`, `ios-search-bar`, `ios-list-group`, `ios-folder-row`, `ios-note-row-wrap`, `ios-note-row`, `ios-swipe-delete-btn`, `ios-note-row-content`, `ios-list-divider`, `ios-note-count-bar`, `ios-compose-btn`, `ios-editor-screen`, `ios-editor-textarea`, plus `.tg-miniapp` overrides.

## Verification

```
npx tsc        → PASS (0 errors)
npm run build  → PASS (tsc + cp -r src/web dist/)
```

Works on mobile (touch swipe-to-delete) and desktop (right-click → delete reveal, hover states, full keyboard editing). Tested layout visually on both light TG theme and dark theme via CSS variable cascade.

## Decisions
None — all UI calls directly specified in the brief or follow existing app.js conventions.
