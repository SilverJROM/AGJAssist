Batch-O4: Telegram /ovm_start + /ovm_end chat relay + menu

Batch ID: O4
Requirements: og-requirements-ovm.md (OU4)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

Context: O2 built the OVM session manager (open-reuse/restart/close) + endpoints; the tmux 'OVM' session runs claude --dangerously-skip-permissions --model sonnet. OU4: let JROM converse with it from Telegram.

Requirement (OU4):
- /ovm_start: enter OVM chat mode for this TG user — reuse-or-open the OVM session (use the same OvmSessionService from O2), then route the user's subsequent PLAIN messages to the OVM tmux session (tmuxService.sendCommand('OVM', text, true, true)) and relay the OVM brain's reply back via bot.sendMessage. Confirm entry ("OVM chat on — talk to me; /ovm_end to stop").
- /ovm_end: exit OVM chat mode (plain messages return to normal handling). Do NOT kill the OVM session (it persists; reuse later).
- Per-user "ovm chat mode" flag in assistant-core (like other per-user state) so plain messages route to OVM only while active; other slash-commands still work.
- Relay reply: after sending the user's text to the OVM pane, wait for the reply (reuse the existing chat/idle-extraction approach used elsewhere — capture the pane, detect the reply completed, extract the assistant's reply text, strip TUI chrome), then bot.sendMessage it. Reuse terminal-chat-state.js / the existing tmux reply-extraction if present; keep it best-effort (timeout + a fallback "OVM is taking a while / still working" message).
- Update telegram-bot.ts setMyCommands to include /ovm_start + /ovm_end (and ensure existing /overmind /om_tasks /om_pause /om_resume /om_drop are listed).

Expected acceptance:
1. /ovm_start opens-or-reuses OVM + enters chat mode + confirms.
2. While in chat mode, a plain TG message is sent to the OVM session and the brain's reply comes back in TG.
3. /ovm_end exits chat mode (OVM session stays alive).
4. setMyCommands includes the new + existing overmind commands.
5. npx tsc clean.

Likely files: src/bot/assistant-core.ts (the two commands + per-user ovm-mode flag + plain-message routing while active + reply relay), src/bot/telegram-bot.ts (setMyCommands), reuse OvmSessionService + tmuxService + terminal-chat-state.
Scope: TG /ovm_start /ovm_end + menu ONLY. Don't change the detector/UI/endpoints. Surgical.
Tests: unit-test the mode flag + routing decision (plain message while ovm-mode → routes to OVM; /ovm_end → normal) with a mocked tmux. Run vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + assistant-core.ts (command dispatch + per-user state + how plain messages are handled) + telegram-bot.ts (setMyCommands + sendMessage) + ovm-session.ts + any existing tmux reply-extraction. Reply STATUS: PROPOSED with the mode flag, routing, reply-relay mechanism, and tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate. Artifacts batch-O4/changes.md + test-report.md + independent-validation.md.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O4 <STATE> <note>, THEN STATUS: <verb> -- reason.
