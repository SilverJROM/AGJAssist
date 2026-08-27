# Agent Window v2 — rationale (final)

Base: sonnet5's mockup, unchanged in design, components, copy, and behavior.
This pass adds **drag-resize** plus the minimum tablet/desktop composition
rules so the surface still holds up at 768 / 1024 / 1440.

## Kept from sonnet5 (everything that is the app)

- Visual language: real-app class names, light/dark/system tokens, bubbles,
  header, key row, composer, bottom sheets.
- 3-state theme harness: Light / System / Dark.
- Group tabs: collapse/expand (‹ / 🗂 N ›) + draggable scrubber.
- Reminders: folder-level, per-agent include/skip, cadence 15/30/45/60/90 +
  custom, stop-after-N vs unlimited, Active tab + Fire now (demo).
- Wakeups: one-time, quick-picks (30s/2m actually fire) + manual date/time,
  pending chip that clears on fire/cancel.
- Summaries dropdown (per-agent, timestamped, via-endpoint tag).
- Named summary-LLM endpoints, default **140**, add/remove/set-default.
- Draft-kept pill + tab dot; key row; send-as-command / send-raw-keys /
  large-input; font A−/A+; ME ▲/▼; search; image attach.
- Folder≡group assumption, flagged to the owner (unchanged).

Phone at **390×780** is the original sonnet5 surface. No phone-band CSS was
added; every wide-layout rule is gated off `data-band="tablet"` / `"desktop"`.

## Resize mechanism (harness only — not app chrome)

A `.cc-frame-shell` wraps the existing `.cc-phone`. Size lives on the shell
(`--frame-w` / `--frame-h`), not inside the app.

- **Right-edge handle** (`.cc-resize-e`): pointer-drag, width only.
- **Bottom-right corner handle** (`.cc-resize-se`): pointer-drag, width+height.
- Range: width 390–1920 (clamped to the window), height 520–(window−180).
- Live readout above the frame: `WIDTHxHEIGHT px` + a **Phone / Tablet /
  Desktop** pill. The same string also floats on the frame while dragging.
- Bands: Phone `< 768`, Tablet `768–1023`, Desktop `≥ 1024`.
- Preset buttons: **390 / 768 / 1024 / 1440**. Click snaps width (height
  stays); the matching preset lights up when the painted width equals it.
- Theme controls are untouched.

## Responsive rules added (tablet + desktop only)

All of these apply only when the *frame* (not the browser) is ≥768px, via
`[data-band="tablet"]` / `[data-band="desktop"]` set by the resize harness.

**Tablet + desktop (≥768)**

1. **Header name** — `.terminal-topbar-target` capped at 220px (`flex: 0 1 220px`)
   so extra width goes to the sibling-tab strip, not a stretched title.
2. **Tab chips** — `.terminal-header-tab` `max-width` 108px → 140px so names
   truncate less when there is room.
3. **Transcript** — horizontal padding `max(16px, calc((100% - 720px) / 2))`
   so the chat sits in a centered ~720px column. Bubbles stay `max-width: 88%`
   of that column (not of a 1440px frame).
4. **Transcript tools** — `right` tracks the same 720px column so the
   refresh + search cluster sits on the column edge, not the far frame edge.
5. **Search bar** — matching side margins + 10px bottom radius so it doesn't
   span the full desktop width.
6. **Key row** — centered, padded to the same column; keys `flex: 0 1 72px;
   max-width: 88px` so ⏎/Esc/^C/⇧⇥/↑/↓ don't inflate across 1440px.
7. **Composer** — same 720px column padding (gradient still full-bleed).
8. **Sheets** — still a bottom sheet, but `width: min(520px, 100%)` and
   horizontally centered (`left: 50%; transform: translateX(-50%)`) instead
   of full-bleed phone chrome.
9. **Summaries popover** — `width: min(440px, calc(100% - 24px))`, left-aligned
   under the chip row, no longer `left+right: 12px` full-bleed.

**Desktop only (≥1024)**

10. **Header name** — cap 220 → 260px.
11. **Tab chips** — max-width 140 → 160px.
12. **Header padding** — 12px → 16px left/right.
13. **Utility chip row** — gap 6px → 8px.
14. **Sheets** — 520 → 560px max.
15. **Readable column** — 720 → 880px for transcript, search, key row, and
    composer, so 1440 isn't a 720px island in a sea of empty surface.

Nothing else in the app contract was restyled. Utility chips, draft badge,
toast, and the 390px header/composer/bubbles are the sonnet5 originals.

## Util-row collapse + default states (incremental)

Utility chips (reminders / wakeup / summaries) now collapse the same way
as the agent-tabs strip: a ‹/› toggle plus a compact dashed pill. Collapsed,
the chip row hides and the pill stays in the header with a tiny live hint —
🔔 + warning dot when a folder reminder is active, ⏰ + pending-wakeup count
when any wakeup is pending — so a PENDING WAKEUP or ACTIVE REMINDER is not
fully hidden.
The two collapses are independent (own toggle, own state).

Default load: **agent tabs start collapsed** (auto-minimized); **util /
reminders row starts expanded**. 390px is otherwise unchanged.

## Collapsed util as row-1 icon + denser row-1 controls (incremental)

Collapsed reminders/util is no longer a thin second-row pill. The second
row hides entirely; a single 28px bell icon sits in the row-1 control
cluster (warning **dot** if a folder reminder is active, tiny **count** if
any wakeup is pending). Tap the icon to restore the full util row.
Expanded util behavior is unchanged. Default load is still **tabs
collapsed, util expanded** (row-1 + reminders row).

Row-1 gear / ME ▲▼ / A− A+ are denser (~28px targets, tighter padding).
The same cluster can tuck behind a ‹ / ⋯ overflow so a fully collapsed
header (tabs + util + controls) is exactly **one row**. The tuck ‹ is
hidden on the default two-row load (util expanded) so 390px keeps the
name + subtitle; it appears once util is collapsed, when the extra
icons need a way off the row.

Summaries popover `top` now tracks the live header height so it still
sits under the chips after the header loses the util row.

## Session refresh (incremental)

Chat can drift from the live tmux session when the owner talks to the
agent directly on the session (outside the mini-app): transcript and
header detail/status go stale. A ↻ button now sits next to the
transcript search magnifier (chat area, not the collapsed header) so it
stays reachable in the one-row-collapsed state. Mock: icon spins →
re-render transcript + header subtitle/status from a fresh pull
(appends the latest on-session line, sets “updated just now”, status
dot live) → brief “Refreshed” toast. No network.

## Group switcher: dropdown vs drag (incremental)

The group agent switcher now follows **frame width** (the same `--frame-w`
that drives `data-band`), via `data-switcher` on `.cc-phone`:

- **&lt; 900px** (phone + narrow tablet): compact **dropdown** — current
  agent (status dot + name + caret). Open → list of the group (status
  dot, name, draft dot, current row highlighted). Select or tap-outside
  closes. No tab strip, no drag scrubber.
- **≥ 900px** (wide tablet + desktop): original **tab strip + collapse
  toggle**, with the drag scrubber **always visible** when the strip is
  expanded. Dragging the thumb pages through the group (same
  `switchAgent()` as tabs and the dropdown). It no longer hides when
  the chips happen to fit.

Resize across ~900px swaps the control live. Defaults unchanged: tabs
collapsed, reminders expanded. Refresh ↻, one-row header, resize
harness, theme, and every other interaction are untouched.
