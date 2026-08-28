FINDING 1 of 3
WHAT FAILED: At 390px, `[data-testid="agent-group-switcher-dropdown"]` resolves in the DOM but is not visible/clickable; screenshot `F5-narrow-a1.png` shows only a clipped sliver beside the Tabs button.
THE FIX: In `src/web/public/style.css`, make the phone-mode switcher allocate real width in `.terminal-header-v2`/`.command-center-header` at `max-width:899px`; the dropdown wrapper/select must have a nonzero visible box inside the header while `.terminal-header-tabs` is hidden.
WHY THE LAST ATTEMPT MISSED IT: It changed `display` in media queries but did not validate element geometry in the constrained Telegram-width header.

FINDING 2 of 3
WHAT FAILED: The phone dropdown is populated from `headerGroupSiblings`, so active `alpha` is missing and the select initially reports `bravo:0.0`; DOM evidence is in `F5-narrow-a1-dom.txt`.
THE FIX: In `src/web/public/app.js`, build a dropdown option list from the full active group, including the active target, and bind the `<select>` value to `activeTarget`; include per-option status text/class plus the existing draft indicator, e.g. active `alpha running` and sibling `bravo idle • draft`.
WHY THE LAST ATTEMPT MISSED IT: It reused the wide strip's "other siblings only" data source for a control that must display the current selection.

FINDING 3 of 3
WHAT FAILED: At 1120px the horizontal strip renders, but there is no switcher-scoped draggable scrubber element or pointer-drag path; `F5-wide-a1-dom.txt` reports `scrubberCount: 0`.
THE FIX: Add a dedicated scrubber control inside the agent group switcher header for `min-width:900px` only, expose it with a stable selector such as `data-testid="agent-group-switcher-scrubber"` or `role="scrollbar"`, and wire pointer drag to update `.terminal-header-tabs.scrollLeft` without changing the tab click `switchActiveTarget` path.
WHY THE LAST ATTEMPT MISSED IT: It relied on native horizontal overflow with hidden scrollbars; the acceptance criterion requires an explicit working draggable scrubber.
