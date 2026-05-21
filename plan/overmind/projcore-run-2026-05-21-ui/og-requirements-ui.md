# Overmind UI Round 2 — Requirements (locked 2026-05-21)

Follow-on to the completed overmind build (R1-R16). All in AGJAssist, branch `feat/overmind`. Frontend = Preact/HTM no-build (src/web/public/app.js + overmind-helpers.js + style.css). Deploy = `npm run build` + `pm2 restart agjassist`. Schema currently v11.

**RU1 — Collapsible workflow cards (auto-collapsed).** Each workflow card on `#/overmind` defaults to COLLAPSED. Collapsed view shows ONLY: workflow **name**, **status badge**, and a **sub-status line** below = the current work being done (`current_task`). All other data (tier, stuck, coordinator/child sessions, tasklist) is hidden until the user expands the card (click/tap to toggle). Remember expand state per card during the session (not required to persist).
*Acceptance:* cards render collapsed by default showing name+status+current_task; clicking expands to reveal the rest; clicking again collapses.

**RU2 — Status color scheme.** Status badge + a card accent use: 🟡 **yellow = working**; 🟢 **green = waiting for me** (`waiting_human` + `awaiting_decision`); 🔴 **red = stopped/bad** (`stuck` + `failed`); ⚪ **grey = done/stopped working** (`completed` + `paused`); `active` (registered, not yet classified) → neutral/yellow-ish. Implement as a pure helper (statusColor) in overmind-helpers.js; apply to badge + card.
*Acceptance:* a working workflow shows yellow, waiting_human/awaiting_decision green, stuck/failed red, completed/paused grey.

**RU3 — Active-session attribution (parent vs child).** The watcher determines WHICH session is currently busy — the parent coordinator or a child codex — by per-pane busy-marker detection (it already captures all panes). Persist this (new column `active_session` TEXT + maybe `active_role` 'parent'|'child'|null; schema v12 migration). The card (expanded detail) shows who's working, e.g. "working: hrcdx-33 (child) · hris-d-22 (parent) idle/waiting". If neither busy → none.
*Acceptance:* when a child codex pane shows busy markers and the parent is idle, the card attributes active work to the child (by session name + role); when the parent is busy, to the parent.

**RU4 — Dashboard Active / Done tabs.** Two tabs on the `#/overmind` view: **Active** = workflows currently in play (`active|working|waiting_human|awaiting_decision|stuck`); **Done** = `completed|paused`. Default to Active. Show counts per tab.
*Acceptance:* hris-d (working) appears under Active; lkcamp+lkvc (paused) under Done; switching tabs filters correctly.

**RU5 — Home Workflows quick-view card.** Add a card/button on the AGJ mini-app **home** screen ("Workflows" / Overmind) that navigates to `#/overmind`. Show a tiny live summary if cheap (e.g. "3 workflows · 1 active").
*Acceptance:* a Workflows card on home opens the overmind dashboard.

**RU6 — Customizable bottom navigation.** Make the bottom nav bar (Home, Tasks, Notes, Terminal, Chat, Settings — and a new Workflows tab) user-customizable: an **edit mode** lets the user **reorder** tabs (↑/↓ or move buttons — NOT drag), **delete/hide** tabs (× / toggle off), and **add** tabs from the available set (incl. Workflows). Persist the chosen tab set + order **per-device (localStorage)** with a sensible default (current tabs) when unset. Edit mode reachable from home (e.g. a small edit/pencil affordance) or settings.
*Acceptance:* user can reorder, remove, and add bottom-nav tabs via move buttons + delete + add picker; the layout persists across reloads (localStorage); Workflows is addable.

**RU7 — Verify/harden projcore auto-register.** Confirm projcore.md §2.11 self-registration works reliably for a NEW run (register fires at run start, lands a row). Harden if a gap is found (e.g. ensure register is non-blocking + retried-once, token read robust). No new entry points (projcore only).
*Acceptance:* a fresh projcore run registers itself on overmind without manual intervention (demonstrated or code-traced + the §2.11 protocol validated).

**Constraints:** match Preact/HTM no-build conventions; pure helpers in overmind-helpers.js (testable in node); density-light; coordinator-only rules unchanged; deploy with `npm run build`. Commit per batch. Live-smoke UI/functionality (esp. RU3 watcher change).
