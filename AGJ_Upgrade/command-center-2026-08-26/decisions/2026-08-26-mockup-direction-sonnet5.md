# Decision — Agent-Window v2 mockup direction: sonnet5 (pending resize + final confirm)

Date: 2026-08-26 · logged by `[north]`

**JROM chose the sonnet5 mockup** as the design direction for agent-window v2 (over grok46). Verbatim:
_"i like the sonnet5 better."_ **Not yet final-confirmed.**

**Before confirming, JROM asked for one addition:** a way to **drag the mockup UI larger** to preview the
experience on **tablet / desktop PC**, not just the fixed 390/600/900 preset buttons. Verbatim:
_"can we have a way to drag this ui to be larger so that i can see the experience as well on a tablet or
desktop pc on the UI … have grok46 redo it based on the sonnet5's mockup."_

**Action:** `grok46` rebuilds on **sonnet5's mockup as the base** — preserving sonnet5's design, components,
behavior, and its 3-state (Light / System / Dark) theme — and ADDS a **draggable resize handle**
(continuous 390px → tablet → desktop) with a live px readout, ensuring the app surface holds up at wide
widths. Output: `mockups/final/agent-window-v2.html`.

**Implication for the contract:** desktop/tablet is now an explicit target. The real app surface must stay
readable and well-composed at tablet/desktop widths — north-star bedrock #3 ("mobile/tablet-first, also
hold up wider") now includes **desktop PC use**.

**Still open (settle at contract lock):** `folder ≡ existing terminal group` (both authors assumed + flagged it).

**Related:** guardian-escalate endpoint = **REMOVE** (folded into the OVM teardown scope).
