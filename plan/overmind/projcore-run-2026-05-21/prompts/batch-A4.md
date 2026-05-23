Batch-A4: Telegram commands + START the watcher loop (live)

Batch ID: A4
Plan: plan/overmind/implementation-plan.md
Requirements: plan/overmind/og-requirements.md (R9, R14-tg) + completes R4 (loop running live)
Branch: feat/overmind (CONTINUE)
North-star anchors: NS-8 (status read = zero tokens), NS-10 (tasklist display)

Estimated duration: SHORT (atomic <30min).

Context (read context-handoff.md first):
A3 built src/services/overmind-watcher.ts (OvermindWatcher with start()/stop()/tick(), POLL_MS=45000) but did NOT start it. A4: (1) instantiate + start the watcher in index.ts so the 45s loop runs live; (2) add the Telegram commands. NO nudging (A5), NO LLM (A6), NO UI panel (A7).

Requirements (verbatim):
R9: "/overmind (status: pure DB read, one line per workflow showing label · status · current_task · done/total task counts), /om_pause <id>, /om_resume <id>, /om_drop <id>, and /om_tasks <id> (full tasklist: done/processing/pending) — added to assistant-core.ts handleCommand() + telegram-bot.ts setMyCommands()."
R4 (completion): "A setInterval(~45s) in OvermindService (started from index.ts ...)."

Observed:
- src/index.ts: OvermindService already instantiated + threaded into API (A2). TmuxService is also constructed here (find it). OvermindWatcher needs (overmindService, tmuxService).
- src/bot/assistant-core.ts: `handleCommand(input)` switch on command; gets services via constructor/setters (e.g. setChatServices). Find how to thread OvermindService in.
- src/bot/telegram-bot.ts: `setMyCommands([...])` array near top.
- OvermindService methods: list(status?), get(id), setStatus(id,status), delete(id). OvermindWorkflow has label, status, current_task, tasks (OvermindTask[] {id,label,state}), coordinator_session.

Expected (acceptance criteria):
1. In index.ts: `new OvermindWatcher(overmindService, tmuxService)` then `.start()` (after services are ready). Loop must be safe with zero workflows. Log one line on start (e.g. "Overmind watcher started (45s)").
2. assistant-core.ts handleCommand cases:
   - `/overmind` — `overmindService.list()` filtered to non-completed (or all active/working/waiting_human/awaiting_decision/stuck/paused). One line each: `<label> <icon> <status> · "<current_task or '—'>" · <done>/<total>` where done = tasks.filter(state==='done').length, total = tasks.length. Icons: working ▶, stuck ⚠, waiting_human ⏸, awaiting_decision ❓, paused ⏯, else •. If none: "No active workflows."
   - `/om_tasks <id>` — get(id); render each task: `[x]` done / `[~]` processing / `[ ]` pending + label. Header = label + status. 404-style message if unknown id.
   - `/om_pause <id>` → setStatus(id,'paused') + confirm; `/om_resume <id>` → setStatus(id,'active') + confirm; `/om_drop <id>` → delete(id) + confirm. Validate numeric id; usage message if missing.
3. telegram-bot.ts setMyCommands gains: overmind, om_tasks, om_pause, om_resume, om_drop with descriptions.
4. `npx tsc` clean.

Likely files:
- src/index.ts (instantiate + start watcher; thread OvermindService into assistant-core if not already)
- src/bot/assistant-core.ts (handleCommand cases + service access)
- src/bot/telegram-bot.ts (setMyCommands)
- tests/overmind-commands.test.ts (NEW) — unit-test the command handlers' output strings against a seeded OvermindService.

Scope:
- Telegram commands + start the loop ONLY. NO sendCommand/nudge, NO LLM, NO UI panel, NO endpoint changes.
- Do NOT change A1/A2/A3 logic (only instantiate+start the watcher).
- Surgical.

Tests (targeted):
- tests/overmind-commands.test.ts: seed OvermindService with 1-2 workflows (varied tasks/status), call the command handler(s), assert the formatted strings (counts, icons, task glyphs) + pause/resume/drop mutate state. Run `npx vitest run tests/overmind-commands.test.ts` + `npx tsc`.
  (If commands are deeply coupled to Telegram, extract the formatting into a pure helper and test that.)

Plan handshake (MANDATORY): read brief + handoff + index.ts (how tmuxService + assistant-core are wired) + assistant-core.ts (command dispatch + service access) + telegram-bot.ts. Reply STATUS: PROPOSED with: how the watcher is started, how OvermindService reaches assistant-core, the exact command output formats, and the test approach. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate (tsc + targeted vitest). Artifacts batch-A4/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion:
- Append callback to plan/overmind/projcore-run-2026-05-21/callbacks.md FIRST: `[projcore callback] A4 <STATE> <note>`, THEN reply.
- End every reply: STATUS: <PROPOSED|DONE|BLOCKED|NEEDS-INFO> -- <reason>.
