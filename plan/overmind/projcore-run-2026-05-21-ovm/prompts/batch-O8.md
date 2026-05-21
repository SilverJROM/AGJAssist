Batch-O8: Proper deterministic IDLE detector — body-frozen + no-active-turn (replaces O6/O7 heuristic)

Batch ID: O8
Requirements: og-requirements-ovm.md (OU7)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

DATA (98 real session-samples, spark+sonnet ground truth, in plan/overmind/research/): frozen-pane→idle = 100% reliable; "pane changed" → working only 47% (the other 53% were IDLE with chrome drift). Normalization (O7) caught 0 of the false-positives. CONCLUSION: judge activity on the CONVERSATION BODY only, ignoring chrome; and an idle session is what we must detect reliably.

THE RULE (replace the current activity logic in src/services/overmind-watcher.ts):
- `extractBody(pane)`: return the pane with these STRIPPED (they are chrome, not work):
  - bottom composer prompt line(s): lines starting with "❯" or "›" (+ their content/placeholder),
  - persistent status/hint bar lines containing any of: "bypass permissions", "ctrl+t", "to manage", "for agents", "/ps to view", "/stop", " shells", " monitors", "/model", model/cwd footers (e.g. lines matching /^\s*(gpt-5|Sonnet|Opus|Haiku)\b/ or ending in "· ~/..."),
  - horizontal-rule lines (runs of ─ or =),
  - spinner/timer lines: lines containing "esc to interrupt", "Working (", "Waiting for", "Compacting", "Thinking", or a leading spinner glyph (◦ • ✻ ✶ ✢ ● ○ ⎿ braille) — especially with a "(…s)"/"(Nm Ns)" timer.
  Then trim trailing blank lines. What remains = the conversation/output body.
- `hasActiveTurn(pane)`: true if the pane contains "esc to interrupt" (the in-progress-turn indicator for both claude + codex).
- ACTIVITY: a session is WORKING ⟺ hasActiveTurn(pane) OR (hash(extractBody(pane)) !== prevBodyHash). IDLE ⟺ NOT hasActiveTurn AND body hash unchanged.
- Use the BODY hash everywhere the change-comparison happens (coordinator last_pane_hash + child hash map + the post-action updates). Replace the O7 normalizePaneForActivity in the activity path with extractBody (you can keep normalize for nothing / remove it).
- Idle accrual → stuck after threshold (unchanged). Parent/child statuses use the same rule (parent working iff its pane has active turn or body changed; child likewise; child "closed" if session missing — unchanged).

Expected acceptance:
1. extractBody + hasActiveTurn pure helpers, exported, node-testable.
2. Activity/change uses BODY hash (chrome/spinner/timer drift no longer counts as "working"). hasActiveTurn OR body-changed = working.
3. Net: idle pane (no active turn, body frozen, chrome drifting) → idle → stuck after threshold. Active-turn or growing body → working. ZERO LLM calls in the tick loop.
4. npx tsc clean.

Likely files: src/services/overmind-watcher.ts (extractBody, hasActiveTurn, body-hash in activity path), tests/overmind-classifier.test.ts (regression).
Scope: the activity/idle determination ONLY. Keep stuck threshold, nudge ladder, brain, waiting_human/decision detection, statuses. Surgical.

Tests (regression from the study):
- a pane where only chrome changes (monitor count "3 monitors"→"5 monitors", or a "(11m 13s)"→"(11m 16s)" timer line, or scrollback drift in a stripped region) BUT body identical + no "esc to interrupt" → extractBody identical → IDLE (after threshold stuck).
- a pane with "esc to interrupt" → working.
- a pane with new body output lines → working.
- existing classifier tests stay green.
Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + overmind-watcher.ts (hashPane, classifyWorkflow, parent/child classifiers, where hashes compared). Reply STATUS: PROPOSED with the extractBody strip list, hasActiveTurn, where the body-hash replaces the current hash, and tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate. Artifacts batch-O8/changes.md + test-report.md + independent-validation.md. projcore will LIVE-VALIDATE against real drifting panes before final sign-off.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O8 <STATE> <note>, THEN STATUS: <verb> -- reason.
