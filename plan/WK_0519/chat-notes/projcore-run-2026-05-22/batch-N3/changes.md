# Batch N3 — iPhone Notes Rich Editor
## Changes

### src/web/public/app.js

**Removed:** `IosNoteEditor` textarea stub (N2).

**Added:** Two helper functions before `IosNoteEditor`:
- `getEditorHtml(el)` — reads `innerHTML` from the contenteditable div; normalizes `<br>` / empty string to `''` for consistent empty detection.
- `prepareInitialHtml(body)` — converts a plain-text stored body (no HTML tags) to `<p>` blocks on first load, so the first-line title CSS fires correctly. If `body` already contains HTML tags (notes saved after N3), passes through unchanged.

**Replaced: `IosNoteEditor`** — full rewrite, same props interface (`note`, `folder`, `onBack`, `onReload`):

#### Contenteditable editor
- `<div ref=editorRef contenteditable="true" …>` replaces `<textarea>`.
- On mount (`useEffect([], [])`): sets `innerHTML` via `prepareInitialHtml`, places cursor at end via `Range.collapse(false)`, then calls `.focus()`. Bypasses Preact diffing entirely — Preact never touches the children of this div.
- `onInput` fires on every keystroke; reads `innerHTML` and calls `scheduleAutoSave`.
- `currentHtmlRef` tracks the latest HTML so `handleBack` always sees the current value even if a save timer is pending.

#### Auto-save (kept from N2 design)
- 800 ms debounce; PATCH `/api/notes/:id { body: html }`.
- `handleBack`: clears the timer, reads current `innerHTML`, flushes a final PATCH if content differs from `note.body`, then calls `onBack()`.

#### Empty-note discard (iPhone behavior)
- `isNewEmpty` ref is set at mount time to `true` if `note.body` was empty/blank.
- On back: if `isNewEmpty` is true AND the current editor content is empty (all HTML stripped = zero non-whitespace chars), DELETEs the note silently and calls `onBack()` — no save, note disappears from list. This matches iPhone Notes behavior where tapping back on an untouched new note discards it.

#### Formatting toolbar
A `div.ios-format-toolbar` below the header bar with six buttons. All use `onmousedown` + `e.preventDefault()` to prevent the editor losing focus before the command fires.

| Button | Label | Implementation |
|--------|-------|----------------|
| Bold | **B** | `document.execCommand('bold')` |
| Italic | *I* | `document.execCommand('italic')` |
| Underline | U̲ | `document.execCommand('underline')` |
| Heading | H | `document.execCommand('formatBlock', false, 'h1')` if current block is not already `<h1>`; toggles back to `'p'` if it is. Block detection walks up the DOM to find the nearest block ancestor inside the editor. |
| Bullet | • ≡ | `document.execCommand('insertUnorderedList')` |
| Checklist | ◯✓ | `document.execCommand('insertHTML', false, '<div class="cl-item" data-checked="false"><button class="cl-btn" …>◯</button><span class="cl-text"> </span></div>')` |

#### Checklists — tap-to-toggle
- Each checklist row is `<div class="cl-item" data-checked="false|true">`.
- The circle button (`.cl-btn`) holds `◯` (unchecked) or `◉` (checked).
- Toggle is handled via **event delegation** on the editor div: `onclick` and `ontouchend` both call `handleEditorClick` which does `e.target.closest('.cl-btn')`. `ontouchend` calls `e.preventDefault()` to suppress the synthetic click, preventing double-fire on iOS.
- On toggle: `data-checked` attribute flips, button text changes, `handleEditorInput()` fires so the new HTML (with updated `data-checked`) is auto-saved.
- CSS: `cl-item[data-checked="true"] .cl-text` gets `text-decoration: line-through; color: var(--text-secondary); opacity: 0.6`. The circle turns iOS green (`#30d158`).

#### First-line title
- CSS rule `.ios-editor-rich > p:first-child, > h1:first-child, > div:first-child:not(.cl-item)` renders at `font-size: 22px; font-weight: 700` — large bold, like iPhone Notes.
- No separate title field. Existing `noteTitle()` / `noteSnippet()` helpers in the list already call `stripHtml()` so they correctly extract the first line of text from the HTML body.

#### HTML round-trip through auto-save
1. User types; `onInput` fires; `innerHTML` (full HTML with `<p>`, `<h1>`, `<ul>`, `<b>`, `.cl-item[data-checked]`, etc.) is debounced-PATCHed to `/api/notes/:id { body: html }`.
2. Backend stores HTML in the `body` column as-is.
3. On next open: `prepareInitialHtml` detects the `<` tag — passes the stored HTML directly to `editorRef.current.innerHTML`. All formatting and checklist states are fully restored.

### src/web/public/style.css

**Replaced** the old `.ios-editor-textarea` block; **added**:

- `.ios-format-toolbar` — horizontal scrollable pill bar between header and editor.
- `.ios-fmt-btn` / `.ios-fmt-divider` — toolbar buttons with accent hover.
- `.ios-editor-rich` — the contenteditable area; `padding-bottom: 60px` for breathing room; `-webkit-overflow-scrolling: touch`; `word-break: break-word`.
- `:empty::before` placeholder via `data-placeholder` attribute.
- First-child large-title rule (22 px / 700 weight).
- `.ios-editor-rich h1`, `p`, `div`, `ul li` — body typography.
- `.cl-item`, `.cl-btn`, `.cl-text` — checklist layout (flex row, circle, text).
- `.cl-item[data-checked="true"]` — strikethrough/dim done state; green circle.

## Verification

```
npx tsc   → exit 0, no output
npm run build → exit 0 (tsc + cp -r src/web dist/)
```

- Both clean on first run after implementation.
- `dist/web/public/app.js` and `style.css` match `src/` (diff empty).

## Decisions log
- **execCommand vs manual**: used `document.execCommand` for bold/italic/underline/formatBlock/insertUnorderedList because it is the most reliable choice in a no-build Preact/htm setup running in mobile WebViews (Telegram Mini App). For checklist, used `insertHTML` execCommand to inject the custom `cl-item` HTML. No third-party library added.
- **Empty-note discard**: chose iPhone behavior — a note that was empty when opened AND is still empty on back is silently deleted. A note that had content (even if partially cleared) is saved normally.
- **First-line title**: CSS `:first-child` rule on the editor container. No JavaScript tracking needed. The list's `noteTitle()` already strips HTML, so preview titles stay correct.
- **Touch double-fire prevention**: `ontouchend` sets `e.preventDefault()` only when the target is `.cl-btn`, so normal scrolling is unaffected.
