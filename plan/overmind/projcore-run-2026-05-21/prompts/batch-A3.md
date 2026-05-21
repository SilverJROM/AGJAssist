Batch-A3: Overmind watcher loop + classifier (DETECTION ONLY — no nudge, no LLM)

Batch ID: A3
Plan: plan/overmind/implementation-plan.md
Requirements: plan/overmind/og-requirements.md (R4, R5, R15-detection)
Branch: feat/overmind (CONTINUE; do not branch)
North-star anchors: NS-2 (watch coordinator+child), NS-3 (talk coordinator-only — but NO talking in A3), NS-8 (deterministic, zero tokens)

Estimated duration: SHORT (atomic <30min). If your PROPOSED reveals >30min/sprawling, propose a split (e.g. A3a pure classifier+unit tests / A3b tick+interval wiring) — do not silently widen.

Context (read context-handoff.md first):
A1 gave OvermindService CRUD. A2 wired endpoints + threaded the service into index.ts/server.ts. This batch adds the DETERMINISTIC watcher: read panes + run_dir mtimes, classify state, update the row. ZERO tokens — pure pattern-matching. NO nudging (A5), NO Sonnet/LLM (A6), NO Telegram, NO UI. Do NOT call tmuxService.sendCommand in this batch.

Requirements (verbatim):
R4: "A setInterval(~45s) in OvermindService (started from index.ts ... ). Per non-terminal workflow: tmuxService.capturePane() the coordinator AND each child session, hash the coordinator pane, scan all captured panes for busy markers (esc to interrupt, Working (, Waiting for, Compacting, Thinking), and stat run_dir mtimes of callbacks.md/progress.md/queue.md. Update the row. No LLM in this loop."
R5 (scoped for A3): "Deterministic state machine driving status: busy markers OR coordinator pane-hash change OR run_dir mtime advance → working (reset stuck timers); a decision-prompt pattern in the coordinator pane (numbered options menu / 'Enter to select' / 'Type something') → awaiting_decision (capture prompt text into pending_decision; do NOT plain-nudge); a plain pending-question/NEEDS-INFO pattern → waiting_human; pane frozen + no busy markers ≥ threshold → stuck. Child-pane signals enrich but the action target is always the coordinator."
SCOPING NOTE (projcore decision): authoritative `completed` is set by projcore's POST /complete (A2). A3's deterministic classifier does NOT infer completed/failed — it classifies only the live action-relevant states: working | stuck | waiting_human | awaiting_decision. Leave completed/failed to the lifecycle endpoint + the brain (A6).

Observed (current state):
- src/tmux/tmux-service.ts: `async capturePane(target: string, lines = 200): Promise<string>` returns pane text (CRLF). Use it for coordinator + each child_session.
- OvermindService (src/services/overmind-service.ts): has CRUD incl update(id, fields), list(status?). child_sessions is string[].
- ~/.claude/agents/watchers/projcore-watcher.sh: busy markers reference.
- A real coordinator decision menu looks like: numbered "1." "2." options, a "Merge / test" style header, and footer "Enter to select · Tab/Arrow keys to navigate". "Type something" / "Chat about this" options also appear.

Expected (acceptance criteria):
1. A PURE, exported, unit-testable classifier function, e.g. `classifyWorkflow(input): ClassifyResult` where input = { coordinatorPane: string, childPanes: string[], coordinatorHashPrev: string|null, mtimeAdvanced: boolean, stuckSincePrev: string|null, now: string } and ClassifyResult = { status: 'working'|'stuck'|'waiting_human'|'awaiting_decision', coordinatorHash: string, pendingDecision: string|null, stuckSince: string|null, lastActivityAt: string|null }. Logic:
   - busy markers in coordinator OR any child, OR coordinator hash changed vs prev, OR mtimeAdvanced → working; clear stuck_since; set last_activity_at = now.
   - else decision-prompt pattern in coordinator → awaiting_decision; capture the menu/question text into pendingDecision.
   - else plain question / "NEEDS-INFO" → waiting_human.
   - else (frozen, no busy, no mtime advance) → set/keep stuck_since; if (now - stuck_since) ≥ STUCK_THRESHOLD (e.g. 90s, a const) → stuck; else keep prior/working-ish. (Pick a sane threshold constant; document it.)
2. A `tick()` async method on a watcher (in OvermindService OR a new OvermindWatcher class — your call, keep it modular): for each non-paused, non-completed workflow → capturePane(coordinator) + each child → compute hash + mtimeAdvanced (stat run_dir files) → classifyWorkflow → overmindService.update(id, {...}) including last_pane_hash, status, pending_decision, stuck_since, last_activity_at, nudge_count untouched.
3. `start()` / `stop()` methods managing a setInterval(~45000ms, a const POLL_MS). **Do NOT call start() anywhere in A3** — A4 wires it into index.ts. Just expose it.
4. `npx tsc` clean.

Likely files:
- src/services/overmind-service.ts (or new src/services/overmind-watcher.ts) — classifier + tick + start/stop
- tests/overmind-classifier.test.ts (NEW) — unit tests for each state
- (no index.ts change in A3)

Scope:
- DETECTION ONLY. No sendCommand/nudge, no LLM, no Telegram, no UI, no endpoint changes.
- Do NOT start the interval. Do NOT change A1/A2 behavior.
- Surgical, modular.

Tests (targeted):
- tests/overmind-classifier.test.ts: feed synthetic panes → assert each status:
  - busy marker → working (stuck cleared)
  - hash-changed → working
  - decision menu text → awaiting_decision + pendingDecision captured
  - plain question / NEEDS-INFO → waiting_human
  - frozen past threshold → stuck (stuck_since set)
  ~4-6 focused unit tests. Run `npx vitest run tests/overmind-classifier.test.ts` + `npx tsc`.

Plan handshake (MANDATORY): read brief + context-handoff.md + tmux-service.ts + overmind-service.ts + the watcher.sh markers. Reply STATUS: PROPOSED with: where the classifier/tick/start live (modularity choice), the exact ClassifyResult shape, the decision-prompt regex/heuristic, the stuck threshold + poll interval consts, and your test list. Flag if you think this should split. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate (tsc + targeted vitest). Artifacts: batch-A3/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion:
- Append callback to plan/overmind/projcore-run-2026-05-21/callbacks.md FIRST: `[projcore callback] A3 <STATE> <note>`, THEN reply.
- End every reply: STATUS: <PROPOSED|DONE|BLOCKED|NEEDS-INFO> -- <reason>.
