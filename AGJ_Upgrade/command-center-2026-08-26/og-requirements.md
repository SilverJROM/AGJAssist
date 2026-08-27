# og-requirements — "command-center" effort

_Authored by `[north]` 2026-08-27. Seeds the validator's Q0 + the req-matrix. Inherits the effort north-star
(`north-star.md`) and the project constitution. **Acceptance criteria are UI-provable on the running app**
(localhost:3101 / Playwright), sized toward **tiller-atomic slices** (one claim provable by execution;
≤~3 named symbols; one layer; glimmer-reachable). The planners (grok46 + sol) turn these into the plan.md
table + fences; they may split further but must cover every AC._

## The verbatim problem (JROM's words)
> "strip down OVM, and destroy it, we just rebuilt it from scratch if we need parts of it later."
> "reminders that i can setup … (scheduled cadence like every 30/45/60/90mins) for each agent … designed to
> solicit updates and possibly have a local agent (granite or even glimmer via lokalAI API) read the reply and
> create a short analysis or summary of it … wakeups act similar but is more of 1time … seen on the chat if
> there is a wakeup pending and clears once triggered."
> "when i chat on a certain agent's window i want the chat i put on it saved … cleared when i send it … so i
> can switch tabs and not lost my chain of thought."
> "the chat does not auto-update on the sessions details text when i … talk to the agent directly on the
> session … a refresh button to basically repull all the details from the session into the chat."
> phone: dropdown for the agent list; draggable only on desktop (tablet if wide). "when all of the things are
> collapsed its only 1 row."

## Design contract
The **locked mockup** `mockups/final/agent-window-v2.html` is the design contract for every UI item below. The
port must match its layout, behavior, and its 3-state theme; the **390px surface is the reference for phone.**
Where an AC and the mockup could conflict, the mockup wins on look/interaction; this doc wins on data/behavior.

## Policies
- **Deferral = OFF.** The app is live and owner-only; fix forward, don't park behavior for "later."
- **Owner-only preserved.** Every new surface/endpoint is owner-gated (account `1000000001`), fail-closed,
  audit-logged; every send still passes the safety-pattern check.
- **Migrations additive-only, ONE authorized exception:** dropping `overmind_projects/workflows/task_history`
  is destructive and JROM-authorized (log it); **DB backup precedes the drop**; all other schema work additive
  with fresh-vs-upgrade parity (SCHEMA_VERSION bump).
- **Do-not-regress** the existing terminal/chat surface (list at the end).

---

## A. Destroy OVM (the app's Overmind feature)
- **A1.** The mini-app no longer exposes Overmind: the **Workflows**, **Overmind Projects**, and **OVM Console**
  screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
- **A2.** The `/api/overmind/*` routes and the `overmind-stream-manager` WebSocket are removed; the server boots
  clean with no overmind service wiring (`overmind-watcher`, `overmind/` brain, notifications) instantiated.
- **A3.** The bot no longer registers `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`,
  `/ovm_start`, `/ovm_end`; sending them yields the normal unknown-command path.
- **A4.** Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only
  columns), with a timestamped DB backup taken first; a **fresh** DB and an **upgraded** DB converge to the same
  schema; `SCHEMA_VERSION` bumped.
- **A5.** After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the
  full unit + e2e suites are green (no dangling overmind imports/types).

## B. Remove the guardian-escalate wire
- **B1.** `POST /api/guardian/escalate` and its route registration are removed; the two helpers it borrowed
  (`isLoopbackAddress`, `buildGuardianEscalationNotification`) are relocated or deleted so nothing else breaks.
- **B2.** The app's internal paging that is NOT guardian (e.g. the reminder scheduler's own Telegram send) is
  unaffected and still works.

## C. Reminders (recurring auto-solicit, folder-level)
- **C1.** From an agent's chat, JROM can open Reminders and **create a folder-level reminder** on the agent's
  group ("folder ≡ the terminal group") that applies to every included agent in it.
- **C2.** A reminder has a **cadence** chosen from presets **15/30/45/60/90 min** or a **custom** minute value.
- **C3.** A reminder has a **repeat** setting: **stop after N** fires (then auto-deactivates) or **unlimited**.
- **C4.** Each agent in the folder has an **include/skip flag**; a skipped agent receives no solicit; toggling it
  is reflected immediately.
- **C5.** On each fire the server **sends the configured solicit text** (default "give me a status update") into
  every included agent's tmux pane — **server-side, whether or not the mini-app is open** — passing the
  safety-pattern check and writing an audit row.
- **C6.** An **active-reminders view** shows, per folder and per agent, the cadence, next-fire, and remaining
  count; it survives an app reload (state is server-persisted, additive schema).

## D. Wakeups (one-time)
- **D1.** From an agent's chat, JROM can schedule a **one-time wakeup** on that single agent: a manual fire
  date/time + a manual **action message** to send.
- **D2.** A **pending wakeup indicator** shows on the agent window (and its collapsed representation) and names
  the pending time; it **clears automatically once the wakeup fires** or is cancelled.
- **D3.** At the fire time the server sends the action into the pane (server-side, safety-checked, audited),
  then marks the wakeup fired.

## E. Summaries (local-LLM analysis of the reply)
- **E1.** After a reminder solicit is answered, the app captures the agent's reply and calls the **default
  summary-LLM endpoint** to produce a short summary/analysis, stored per agent (additive schema).
- **E2.** The agent window has a **Summaries dropdown** listing that agent's summaries, timestamped, newest
  first, scrollable; empty state reads sensibly.
- **E3.** A summary records which endpoint produced it; the LLM call failing degrades gracefully (no crash; the
  reminder/solicit still succeeds).

## F. Summary-LLM endpoints (configurable, named)
- **F1.** A settings surface manages **named endpoints** — name + base URL + model — assumed **OpenAI-compatible**
  (`/v1/chat/completions`); add / edit / remove.
- **F2.** One endpoint is the **default**; the seeded default is labelled **140** (lokalAI). Changing the default
  is reflected in which endpoint E1 uses.
- **F3.** Endpoint config is owner-only, persisted (additive schema), and never logs secrets in plaintext.

## G. Per-agent draft persistence
- **G1.** Text typed in an agent's composer is **kept per-agent**; switching to another agent and back
  **restores** it (unsent), with a subtle "draft kept" affordance.
- **G2.** **Sending** the message **clears** that agent's stored draft; an agent with an unsent draft shows a
  small indicator on its tab/switcher entry.
- **G3.** Draft state is per-viewer/client (localStorage keyed by pane), survives tab switches and an app reload,
  and never leaks one agent's draft into another's composer.

## H. Agent-window v2 UI (port the locked mockup)
- **H1.** The Terminal chat header matches the mockup: **independent collapse/expand for the agent tabs and for
  the reminders/util row**, defaulting to **tabs collapsed, reminders expanded**.
- **H2.** Collapsing the reminders/util row leaves a **single clickable bell icon on the top row** (with a
  pending-hint dot/count), not a second row; the gear/ME/font controls are compact and can tuck to `⋯`, so that
  **when everything is collapsed the header is one row**.
- **H3.** The surface is **theme-adaptive** (light/dark follows the device setting) and **readable**; it holds up
  **mobile / tablet / desktop** — wide widths keep a centered readable column rather than edge-to-edge text.

## I. Refresh-from-session
- **I1.** The chat has a **↻ refresh control** (reachable regardless of header collapse state) that **re-pulls the
  live tmux session** — re-rendering the transcript AND updating the session detail/status text — so a direct
  on-session interaction that had drifted is now reflected.
- **I2.** Refresh shows a brief in-progress state and confirms completion; it never blocks the composer.

## J. Responsive group switcher
- **J1.** At **phone / narrow widths** the group agent switcher is a **dropdown** (current agent + caret → tap →
  pick from the group list, with status + draft indicators); no drag control.
- **J2.** At **wide tablet / desktop widths** it is the horizontal strip **+ a working draggable scrubber**; the
  presentation swaps by width and both paths switch the active agent identically.

## Candidate INTEGRATION fences (planners finalize at §1.4)
Grouped by independently-testable capability — **enumerate contributing slices in `deps`, carry the reason in
`scope`**; use a stronger tier + `redteam=elite`; the fence test must load the Mini App in a browser:
- **F-OVM**: OVM+guardian fully removed, app boots, suites green, migration parity (A1–A5, B1–B2).
- **F-REMINDERS**: schedule → server-side solicit fires into a pane → summary lands in the dropdown (C1–C6, E1–E3, F1–F3).
- **F-WAKEUP**: schedule → pending chip → fires → chip clears + action sent (D1–D3).
- **F-WINDOW**: agent-window v2 header/collapse/theme/responsive + refresh + draft persistence match the mockup
  across phone/tablet/desktop (G1–G3, H1–H3, I1–I2, J1–J2).

## PROMOTION CLEANUP (required, gated)
Delete dead OVM code/files, the `overmind_*` schema, and the temporary port scaffolding (backup HTML revisions
`*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`) at the promotion boundary. The `mockups/` design record stays.

## Do-not-regress (existing terminal/chat surface must keep working)
Key row (Enter/Esc/^C/Shift-Tab/↑/↓) · send-as-command / send-raw-keys / large-input · image attach (upload +
paste) · ME ▲/▼ nav · chat search + jump · font A−/A+ · group quick-switch tabs · selection-prompt rendering
(question + descriptions + single/multi + type-something) · working/idle busy flag · theme re-apply on
themeChanged · owner-only auth (mini-app + bot) · the tmux send/keys REST path (tunnel has no WS).
