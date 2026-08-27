# Agent Window v2 — rationale (sonnet5)

Single file: `agent-window-v2.html`. No backend, no build step, no external
deps (system font stack only — matched the real app rather than importing a
Google Font). Verified with a headless-DOM interaction pass (every control
exercised via jsdom) and Playwright screenshots in light/dark at 390/600/900px
— zero console/page errors.

## Fidelity approach
Reused the real app's class names verbatim wherever the element already
exists in `src/web/public/{style.css,app.js}` — `terminal-shell`,
`terminal-shell-header`, `terminal-header-tabs`/`terminal-header-tab`,
`terminal-chat-*`, `ovm-chat-*`, `terminal-sheet-*`, `terminal-switch`,
`terminal-seg`, `terminal-control-bar`, `badge`, `toast`, etc. — including the
exact light/dark token values from `.terminal-shell`'s CSS variables. New v2
surfaces use a `cc-` prefix so a builder can tell at a glance what's
existing-contract vs. new-in-this-mockup. All four new panels (Reminders,
Wakeup, Summaries popover, Endpoints) are separate instances of the same
`.terminal-menu-sheet` bottom-sheet pattern already used for Terminal
Settings — no new sheet mechanism invented.

## Key decisions
- **Folder = the sibling-tab group.** The brief's "folder" isn't modeled
  anywhere else in the app today; I mapped it onto the same agent set already
  shown in the header tab strip, since that's the only existing grouping
  concept. **Flag to the owner**: confirm folder≡group before build, or if a
  separate folder/project entity exists server-side, wire the per-agent list
  to that instead.
- **Collapse + scrubber live in the header, not a separate row.** The
  collapse toggle (‹/›) sits left of the tab strip; expanded, a hairline
  scrubber track renders under the tabs only when they overflow. Dragging the
  scrubber (pointer events, touch-friendly) or the tabs themselves both work
  — sync is two-way.
- **New chips row below the header, not squeezed into it.** Reminders,
  Wakeup, and Summaries got their own horizontally-scrollable chip row
  (`.cc-util-row`) directly under the existing header row, rather than more
  icon buttons crammed into the already-tight top row. This is the one
  genuinely new piece of chrome; everything else reuses existing patterns.
- **Deep-linked twice.** Each of the three new features is reachable both
  from its header chip (fast glance + action) and from the Settings gear
  sheet (`Command center` section) — so nothing is undiscoverable if the chip
  row scrolls off-screen on a very cluttered agent.
- **Demo affordances, clearly labelled.** Real cadences (15–90 min) and
  distant wakeup times can't be waited out during a review click-through, so
  I added an explicit "Fire now (demo)" button on the Reminders Active tab
  and two short real timers ("in 30s (demo)" / "in 2m (demo)") on Wakeup —
  these genuinely fire via a 1s ticker, they're not faked. Both are visually
  marked "(demo)" so a builder knows they're a mockup convenience, not a
  requirement to ship a manual-fire button in prod (though it's a reasonable
  one to keep for ops/testing).
- **Draft-kept is two signals, not one.** A transient "✎ Draft kept" pill
  above the composer on switch-back, plus a small persistent dot on any
  sibling tab that's holding an unsent draft — so the state is discoverable
  even before you switch to it.

## One real bug caught and fixed during self-review
The initial layout let the sibling-tab strip's flex-basis win against the
agent name box, truncating the header name to "h.." at 390px — a direct
violation of the brief's #1 priority (readability). Fixed by giving the name
box a floor (`min-width`, capped `max-width`) and letting the tab strip give
up space first, since it already has the scrubber/scroll/collapse toggle to
compensate. Caught via an actual Playwright screenshot at default width, not
just code review — worth re-checking on port.

## Tradeoffs / open questions for the owner or builders
1. Per-agent reminder skip vs. a hypothetical "snooze" — v1 as specced is
   binary include/skip; no snooze/pause-one-cycle. Fine for v1, flagging in
   case it comes up.
2. Summaries popover is anchored under the utility row at a fixed offset
   rather than computed from the trigger chip's exact position — simpler and
   robust across widths, but a pixel-perfect implementation might prefer
   anchoring to the chip's `getBoundingClientRect()`.
3. Endpoint config has add/remove/set-default but no inline edit of an
   existing endpoint's URL/model — matches the brief's "manage named
   endpoints" ask without over-building; add if the owner wants it.
4. Wakeup and Reminders both write directly into the transcript as an
   auto-sent user turn when they fire (matching "auto-sends a solicit into
   the agent") — worth confirming that's the intended channel vs. a
   side-channel system event that doesn't count as a transcript turn.
