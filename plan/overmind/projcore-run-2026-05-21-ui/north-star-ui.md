# North-Star — Overmind UI Round 2 (locked 2026-05-21)

Inherits the original north-star (NS-1..NS-12). New decisions (JROM, 2026-05-21):

- **UI-NS-1 — Status colors:** 🟡 working · 🟢 waiting for me (waiting_human + awaiting_decision) · 🔴 stuck OR failed (stuck=RED) · ⚪ grey = completed OR paused (done/stopped working).
- **UI-NS-2 — Active/Done tabs are DASHBOARD-LEVEL:** Active = workflows still in play; Done = completed/paused. (Not per-workflow task tabs.)
- **UI-NS-3 — Auto-register scope = projcore ONLY** (already wired in projcore.md §2.11); RU7 = verify/harden that path, no new entry points (/coord, /lead not touched).
- **UI-NS-4 — Quick link = a card on the web home screen** (RU5), AND separately the bottom nav is customizable (RU6).
- **UI-NS-5 — "Quick access" to manage = the BOTTOM NAV BAR tabs** (Home/Tasks/Notes/Terminal/Chat/Settings + Workflows), per the screenshot — not the home section cards. Reorder via **move buttons (not drag)**, delete, add. Persist **per-device (localStorage)**.
- **UI-NS-6 — Collapsed card** shows name + status + sub-status (current_task) only; the rest expands on tap. Auto-collapsed by default.
- **UI-NS-7 — Active-session attribution (RU3)** is a real functionality add: the watcher detects which of parent-coordinator / child-codex is busy and the card shows it.
