# Mockup Brief — Agent-Window v2 (command-center effort)

_Authored by `[north]`, 2026-08-26. Two-author competition: `grok46` (grok-build) vs `sonnet5`. The owner (JROM) picks one; **the pick becomes the build contract.**_

## Context
AGJAssist is JROM's single-owner, **phone-first command center** for driving AI coding agents (Claude/Codex/Grok) running in tmux, via a Telegram mini-app. Frontend = **no-build Preact + htm**, `src/web/public/{app.js, style.css, terminal-chat-state.js}`. **Ground yourself in the real aesthetic** before designing: read `style.css` and the terminal views in `app.js` (search `FriendlyTerminalView`, `TerminalTab`, `terminal-header-tabs`, `terminal-selection`, the composer). **Build on the existing shell — do not reinvent it.**

**Current state** (the agent window today): header with agent name + a strip of sibling-agent quick-switch tabs + A‑/A+ font + ME ▲/▼ nav + gear; a friendly chat transcript; a key row (Enter/Esc/^C/Shift‑Tab/↑/↓); Send-as-command / Send-raw-keys / Large-input; and a "Message the agent…" composer with image attach + send.

## Goal
Design **agent-window v2** — the per-agent terminal-chat window, extended with the new command-center capabilities below. Deliver ONE self-contained, clickable HTML mockup.

## Required elements — ALL must appear, cohesively

1. **Group tabs — collapse/expand + draggable scrubber.** The sibling-agent tab strip (e.g. `hris-4430`, `lkAsst-0`, `wflow-3762`, `lokalAI2-465`). Add (a) a quick **collapse/expand toggle** to hide the strip sideways and reclaim space, and (b) a **subtle draggable handle/scrubber** to swipe through *all* agents in the group when more exist than fit. Must feel native to a phone (touch-drag).

2. **Reminders — recurring auto-solicit, folder-level with per-agent flags.**
   - Set a reminder on a **folder ("global"/work folder)** → applies to every agent in it.
   - **Per-agent include/skip flag** to opt individual agents out.
   - **Cadence:** presets **15 / 30 / 45 / 60 / 90 min** + a **custom** minutes entry.
   - **Repeat:** **stop after N** fires, or **unlimited**.
   - Each fire auto-sends a solicit (e.g. "give me a status update") into every included agent.
   - **See active reminders** — both per-agent and a folder-level view — showing cadence, next-fire, and remaining count.

3. **Wakeups — one-time.**
   - One-time scheduled action on a single agent (canonical use: "wake it after its weekly reset and tell it to start working").
   - Manual **fire-time** + manual **action** (a message/keys to send) for v1.
   - A **pending indicator (chip/badge) on the agent window** that **clears once it fires**.
   - Setup UI: pick time, type the action message.

4. **Summaries dropdown.**
   - After a reminder solicit, a local LLM summarizes the agent's reply.
   - Summaries accumulate per agent, **browsable via a dropdown on the agent window** — open it and scroll timestamped past summaries.

5. **Summary-LLM endpoint config (a small settings surface).**
   - Manage **named endpoints** — name + base URL + model, OpenAI-compatible (lokalAI / OpenRouter / any).
   - Choose a **default** (default today = a lokalAI endpoint labelled "140").

6. **Draft persistence** (behavioral — minimal to draw). The composer keeps a **per-agent unsent draft** that survives switching agents and clears on send. A subtle "draft kept" affordance is enough.

## Design constraints (bedrock — from the project north-star)
- **Mobile/tablet-first, ~390px primary width** (must also hold up wider).
- **Theme-adaptive** — must look right in BOTH light and dark (follows the device setting). **Include a light/dark preview toggle in the mockup.** NOT dark-only.
- **Readability first** — the app's #1 priority.
- **Match the current visual language** (bubbles, composer, header controls, key rows).
- **Self-contained single HTML file** — inline CSS/JS, static/placeholder data, no real backend, no external deps (Google Fonts allowed).
- **Actually clickable** where it matters: open reminder setup, toggle a per-agent flag, open the summary dropdown, collapse/expand + drag the tab scrubber, show a pending wakeup chip.

## Do NOT
- Wire a real backend, or redesign unrelated screens.
- Remove existing agent-window functions (key rows, send-as-command/raw-keys, font, ME‑nav, image attach, search) — **v2 ADDS to them.**

## Deliverable (in your assigned dir)
- `agent-window-v2.html` — the self-contained, clickable mockup.
- `rationale.md` — short: key design decisions, tradeoffs, anything you'd flag to the owner or the builders.

_This is a contract-grade artifact: make it complete and **buildable**, not just pretty._
