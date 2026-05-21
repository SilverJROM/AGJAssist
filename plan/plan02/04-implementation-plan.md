# 04 - Implementation Plan: VS Code-like Code Tab

**Project**: AGJAssist
**Date**: 2026-03-07
**Cost Mode**: saver40 (60% Opus / 40% Sonnet)
**Upstream Docs**: None (standalone invocation - built from requirements + codebase analysis)
**One-Shot Execution Contract**: Active

---

## Task Distribution Matrix

```
Total Tasks: 7
elitedev01 (Opus):   4 tasks (57%) - File API security, Monaco integration, context menu, Polish
elitedev02 (Sonnet): 3 tasks (43%) - File tree UI, CRUD routes, tab bar UI
```

---

## TASK-001: Backend File System API (Security-Critical)

**Owner**: `elitedev01` (Opus) - Security-critical path traversal prevention
**Requirement**: Sandboxed file operations within project root directory

### Goal
Create `src/services/file-service.ts` and `src/api/routes/file-routes.ts` providing secure file system access scoped to each project's directory.

### Files In Scope
- `src/services/file-service.ts` (NEW)
- `src/api/routes/file-routes.ts` (NEW)
- `src/api/server.ts` (EDIT - register routes)

### Inputs & Dependencies
- `src/services/project-service.ts` - provides `getFullPath(project)` for project root resolution
- `src/config/config.ts` - `projects.root` = `/home/agjrom/websites`
- Existing auth middleware pattern from other routes

### Expected Output

**FileService** (`src/services/file-service.ts`):
- `listDirectory(projectRoot: string, relativePath: string)` - returns `{ name, type: 'file'|'directory', size, modified }[]`
- `readFile(projectRoot: string, relativePath: string)` - returns `{ content: string, encoding: string, size: number }`
- `writeFile(projectRoot: string, relativePath: string, content: string)` - saves file
- `createFile(projectRoot: string, relativePath: string, content?: string)` - creates new file
- `createDirectory(projectRoot: string, relativePath: string)` - creates directory
- `deleteEntry(projectRoot: string, relativePath: string)` - deletes file or empty directory
- `renameEntry(projectRoot: string, oldPath: string, newPath: string)` - rename/move
- `copyEntry(projectRoot: string, srcPath: string, destPath: string)` - copy file
- `getFileInfo(projectRoot: string, relativePath: string)` - stat info

**Security (CRITICAL)**:
- Every method MUST resolve the full path and validate it starts with `projectRoot` after `path.resolve()` to prevent path traversal (`../../../etc/passwd`)
- Reject paths containing `..` segments that escape project root
- Reject symlinks that point outside project root
- Binary file detection (return base64 or reject for non-text files)
- Max file size check for reads (e.g., 5MB limit)
- Ignore `.git` directory contents by default (configurable)

**File Routes** (`src/api/routes/file-routes.ts`):
- `GET /api/projects/:id/files?path=` - list directory
- `GET /api/projects/:id/files/read?path=` - read file content
- `PUT /api/projects/:id/files?path=` - write/update file `{ content }`
- `POST /api/projects/:id/files?path=` - create file/dir `{ type: 'file'|'directory', content? }`
- `DELETE /api/projects/:id/files?path=` - delete file/dir
- `POST /api/projects/:id/files/rename` - rename `{ oldPath, newPath }`
- `POST /api/projects/:id/files/copy` - copy `{ srcPath, destPath }`
- All routes require auth + owner role

### Acceptance Checks
1. Path traversal attempts return 403
2. Symlink escape attempts return 403
3. Files > 5MB return 413
4. Binary files detected and handled appropriately
5. All CRUD operations work correctly
6. `.git` directory hidden by default
7. Routes registered in server.ts

### Stop Conditions
- All 7 acceptance checks pass
- No path traversal vulnerability exists

---

## TASK-002: File Tree UI Component

**Owner**: `elitedev02` (Sonnet) - Standard UI component
**Requirement**: Collapsible folder tree in left panel of Code tab

### Goal
Add a `CodeTab` component to `app.js` with a file tree sidebar that loads directory contents lazily.

### Files In Scope
- `src/web/public/app.js` (EDIT - add CodeTab component)
- `src/web/public/style.css` (EDIT - add file tree styles)

### Inputs & Dependencies
- TASK-001 must be complete (File API endpoints)
- Existing `ProjectDetail` component with tabs array at line 241

### Expected Output

**CodeTab component** in `app.js`:
- Add `'code'` to the tabs array in `ProjectDetail` (line 241)
- Render `CodeTab` when code tab is active
- Layout: left sidebar (250px) with file tree + right panel for editor
- File tree loads root directory on mount via `GET /api/projects/:id/files?path=`
- Clicking a folder toggles expand/collapse and lazy-loads children
- Clicking a file emits selection (calls `onFileSelect(path)` callback)
- File/folder icons (use unicode: 📁/📄 or CSS-based)
- Show loading state while fetching
- Indent nested items (padding-left per depth level)

**CSS additions** (`style.css`):
- `.code-container` - flex layout with sidebar + editor panel
- `.file-tree` - left sidebar styling (scrollable, bordered)
- `.tree-node` - individual file/folder item (hover, active states)
- `.tree-node-file` vs `.tree-node-dir` - type-specific styling
- Depth-based indentation

### Acceptance Checks
1. Code tab appears in ProjectDetail tabs
2. Root directory loads on tab mount
3. Folders expand/collapse on click
4. Files highlight on selection
5. Lazy loading works (subdirectories load on demand)
6. Proper depth indentation
7. Loading states shown

### Stop Conditions
- File tree renders and navigates correctly
- File selection triggers callback

---

## TASK-003: Monaco Editor Integration

**Owner**: `elitedev01` (Opus) - Complex CDN integration + language detection
**Requirement**: VS Code editor experience with syntax highlighting and file editing

### Goal
Integrate Monaco Editor via CDN into the Code tab's right panel, with file loading, language detection, and save functionality.

### Files In Scope
- `src/web/public/app.js` (EDIT - add MonacoEditor component)
- `src/web/public/index.html` (EDIT - may need Monaco loader script)

### Inputs & Dependencies
- TASK-001 complete (read/write API)
- TASK-002 complete (file tree provides file selection)

### Expected Output

**MonacoEditor component**:
- Load Monaco Editor from CDN (`https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs`)
- Use `require.config` + `require(['vs/editor/editor.main'])` pattern (AMD loader)
- Create editor instance on mount, dispose on unmount
- When file is selected: `GET /api/projects/:id/files/read?path=...` then set editor value
- Language auto-detection from file extension (`.ts`->typescript, `.js`->javascript, `.json`->json, `.py`->python, `.md`->markdown, `.css`->css, `.html`->html, `.sql`->sql, etc.)
- Dark theme matching app color scheme (`vs-dark` customized)
- Save: `Ctrl+S` / `Cmd+S` triggers PUT to write file API
- Modified indicator (dot/circle) when content differs from saved version
- Editor options: minimap on, word wrap off, font size 13, tab size 2

**Tab bar** (above editor):
- Show currently open file name
- Modified indicator
- Close button (x)
- Breadcrumb path display: `src / components / App.tsx`

### Acceptance Checks
1. Monaco loads from CDN without errors
2. File content displays with correct syntax highlighting
3. Ctrl+S saves file successfully
4. Modified indicator shows when content changes
5. Language detection works for common extensions
6. Editor resizes properly with window
7. Editor disposes cleanly on unmount/file switch

### Stop Conditions
- Editor loads, displays, edits, and saves files correctly
- No memory leaks from editor instances

---

## TASK-004: Context Menu & File Operations

**Owner**: `elitedev01` (Opus) - Complex interaction patterns
**Requirement**: Right-click context menu on file tree items

### Goal
Add a right-click context menu to the file tree with common file operations.

### Files In Scope
- `src/web/public/app.js` (EDIT - add ContextMenu component, update FileTree)
- `src/web/public/style.css` (EDIT - add context menu styles)

### Inputs & Dependencies
- TASK-001 complete (all file operations API)
- TASK-002 complete (file tree to attach context menu to)

### Expected Output

**ContextMenu component**:
- Positioned at cursor on right-click
- Closes on click outside or Escape
- Items for files: Copy Path, Copy Relative Path, Rename, Delete, Duplicate
- Items for folders: New File, New Folder, Copy Path, Rename, Delete
- Each action calls appropriate API endpoint
- Rename: inline text input in tree item
- New File/Folder: inline text input at tree position
- Delete: confirmation prompt
- Copy Path: copies to clipboard via `navigator.clipboard.writeText()`

**CSS additions**:
- `.context-menu` - floating menu styling (dark theme, shadow, border radius)
- `.context-menu-item` - individual item (hover state)
- `.context-menu-separator` - divider line

### Acceptance Checks
1. Right-click shows context menu at cursor position
2. Context menu closes on click outside / Escape
3. All file operations work (rename, delete, duplicate, new file/folder)
4. Copy Path copies correct path to clipboard
5. Inline rename works with Enter to confirm, Escape to cancel
6. Proper error messages on failed operations

### Stop Conditions
- All context menu operations functional
- No orphaned event listeners

---

## TASK-005: Multi-Tab Editor Support

**Owner**: `elitedev02` (Sonnet) - Standard UI pattern
**Requirement**: Multiple file tabs open simultaneously

### Goal
Support opening multiple files in tabs, switching between them, closing tabs with unsaved change warnings.

### Files In Scope
- `src/web/public/app.js` (EDIT - update CodeTab state management)
- `src/web/public/style.css` (EDIT - tab bar styles)

### Inputs & Dependencies
- TASK-003 complete (Monaco editor working for single file)

### Expected Output

**Tab management state**:
- `openTabs` array: `[{ path, name, content, originalContent, language }]`
- `activeTab` index
- Opening a file: adds to tabs if not already open, switches to it
- Closing a tab: warns if unsaved changes (`content !== originalContent`)
- Tab click: switches active tab, preserves editor state
- Tab close button (x): close with unsaved warning
- Middle-click to close tab

**Tab bar UI**:
- Horizontal scrollable tab bar above editor
- Active tab highlighted
- Modified files show dot indicator
- Close button on each tab
- Overflow: horizontal scroll

### Acceptance Checks
1. Multiple files can be opened simultaneously
2. Switching tabs preserves content
3. Unsaved changes warning on close
4. Modified indicator on tab
5. Tab bar scrolls when many tabs open
6. Middle-click closes tab

### Stop Conditions
- Multi-tab works without losing content
- Unsaved warning prevents data loss

---

## TASK-006: Quick Open & Search

**Owner**: `elitedev02` (Sonnet) - Standard UI feature
**Requirement**: Ctrl+P quick open dialog

### Goal
Add a Ctrl+P quick open dialog that searches files by name across the project.

### Files In Scope
- `src/web/public/app.js` (EDIT - add QuickOpen component)
- `src/web/public/style.css` (EDIT - add quick open styles)
- `src/services/file-service.ts` (EDIT - add recursive file listing)
- `src/api/routes/file-routes.ts` (EDIT - add search endpoint)

### Inputs & Dependencies
- TASK-001 complete (file API)
- TASK-002 complete (file tree for opening files)

### Expected Output

**Backend addition**:
- `FileService.searchFiles(projectRoot, query, maxResults)` - recursive search by filename (not content)
- `GET /api/projects/:id/files/search?q=&limit=20` - search endpoint
- Respects `.gitignore` patterns if feasible, at minimum skips `node_modules`, `.git`, `dist`, `build`

**QuickOpen component**:
- `Ctrl+P` / `Cmd+P` keyboard shortcut opens modal
- Text input with instant filtering
- Shows matching files with relative path
- Up/Down arrow navigation
- Enter opens selected file
- Escape closes
- Fuzzy-ish matching (substring on filename + path)

**CSS additions**:
- `.quick-open-overlay` - centered modal overlay
- `.quick-open-input` - search input styling
- `.quick-open-results` - scrollable results list
- `.quick-open-item` - result item (selected state)

### Acceptance Checks
1. Ctrl+P opens quick open dialog
2. Typing filters files in real-time
3. Arrow keys navigate results
4. Enter opens selected file
5. Escape closes dialog
6. Skips `node_modules`, `.git` directories
7. Results limit prevents UI overload

### Stop Conditions
- Quick open works smoothly
- Performance acceptable (< 500ms for search)

---

## TASK-007: Polish & Integration Testing

**Owner**: `elitedev01` (Opus) - Integration verification
**Requirement**: Final polish pass and end-to-end verification

### Goal
Review all components together, fix integration issues, add breadcrumbs, ensure clean UX.

### Files In Scope
- `src/web/public/app.js` (EDIT)
- `src/web/public/style.css` (EDIT)
- All files from TASK-001 through TASK-006

### Inputs & Dependencies
- All previous tasks complete

### Expected Output
1. **Breadcrumb navigation**: Show path segments above editor (`src > components > App.tsx`)
2. **Empty state**: When no file is selected, show helpful message
3. **Error handling**: Network errors during save show toast/notification
4. **Keyboard shortcuts**: Document and verify Ctrl+S, Ctrl+P
5. **Responsive**: Code tab works reasonably on smaller screens
6. **Loading states**: Skeleton/spinner during file loads
7. **Edge cases**: Handle deleted files, renamed files, binary files gracefully
8. **Clean up**: Remove any debug console.logs, ensure no memory leaks

### Acceptance Checks
1. Full flow works: navigate to project -> code tab -> browse tree -> open file -> edit -> save
2. Context menu operations all functional
3. Multi-tab switching preserves state
4. Quick open finds files correctly
5. No console errors
6. No memory leaks (editor disposal)
7. Breadcrumbs update on file switch

### Stop Conditions
- Full end-to-end flow works without errors
- All acceptance checks pass

---

## Execution Order

```
TASK-001 (elitedev01) ──┐
                        ├──> TASK-002 (elitedev02) ──> TASK-003 (elitedev01)
                        │                                    │
                        ├──> TASK-004 (elitedev01) ──────────┤
                        │                                    │
                        └────────────────────────────> TASK-005 (elitedev02)
                                                             │
                                                       TASK-006 (elitedev02)
                                                             │
                                                       TASK-007 (elitedev01)
```

**Parallel opportunities**:
- TASK-002 and TASK-004 can start after TASK-001 (TASK-004 context menu can be built while tree is being built)
- TASK-005 and TASK-006 can run in parallel after TASK-003

**Critical path**: TASK-001 -> TASK-002 -> TASK-003 -> TASK-007

---

## Agent Assignment Rationale

| Task | Agent | Rationale |
|------|-------|-----------|
| TASK-001 | elitedev01 | Security-critical: path traversal prevention, symlink escape |
| TASK-002 | elitedev02 | Standard UI: collapsible tree, lazy loading |
| TASK-003 | elitedev01 | Complex: Monaco CDN integration, AMD loader, language detection |
| TASK-004 | elitedev01 | Complex: right-click menus, inline rename, clipboard API |
| TASK-005 | elitedev02 | Standard UI: tab bar state management |
| TASK-006 | elitedev02 | Standard UI: search modal, keyboard nav |
| TASK-007 | elitedev01 | Integration: cross-component verification, edge cases |

---

## Fallback Protocol

- If `elitedev02` struggles with a task (>2 iterations), escalate to `elitedev01`
- If `elitedev01` hits loop limit: Codex x2 -> Opus x2 -> User STOP

---

## Post-Implementation: Update Project Documentation

**AFTER all implementation tasks are complete and tested**, update:

### 1. Update `project_specs.md`
- Add Code Tab feature to feature inventory
- Add File API to architecture/components section
- Document Monaco Editor integration

### 2. Update `changelog.md`
- Add entry for Code Tab feature with Added/Technical sections
