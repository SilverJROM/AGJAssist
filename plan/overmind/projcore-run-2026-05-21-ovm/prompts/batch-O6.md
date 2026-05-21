Batch-O6: URGENT classifier fix — activity = pane CHANGE, not stale marker text

Batch ID: O6
Requirements: og-requirements-ovm.md (OU6)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

LIVE BUG (just diagnosed on lkcamp): a stuck coordinator (frozen pane, empty composer, waiting to review codex's proposal) was classified `working` forever and NEVER nudged — because the busy-marker regex (BUSY_MARKER_RE = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i) matched incidental "Waiting for" text in the idle recap/task list. The classifier in src/services/overmind-watcher.ts treats busy-marker PRESENCE as "working" even when the pane is FROZEN (hash unchanged). Three spots: classifyWorkflow (~line 133 `hasBusyMarker || coordinatorHashChanged || input.mtimeAdvanced`), the parent classifier (~line 178 `if (BUSY_MARKER_RE.test(coordinatorPane)) return "working"`), the child classifier (~line 203 `BUSY_MARKER_RE.test(pane) ? "working" : "idle"`).

THE FIX: "working" must require ACTUAL CHANGE, never stale marker text.
1. Overall classifyWorkflow: working ⟺ coordinatorHashChanged OR input.mtimeAdvanced OR anyChildPaneHashChanged. REMOVE the standalone `hasBusyMarker` trigger. (A frozen pane with marker text → NOT working → falls through to stuck-accrual.)
2. Child hash tracking: the classifier currently only compares the coordinator hash (last_pane_hash). Add CHILD pane hash tracking so a child that's actively working (its pane changing) keeps the workflow "working" even when the coordinator is idle. Store child hashes across ticks — in-memory in the OvermindWatcher instance keyed by workflow id (Map) is acceptable (coordinator hash stays in last_pane_hash). On first observation (no prev) treat as changed=working, then settle.
3. Parent status classifier: parent_status "working" ⟺ the coordinator pane changed (not marker presence). Else evaluate idle/waiting_human/awaiting_decision/stuck from its content as before.
4. Child status classifier: a child's status "working" ⟺ that child's pane changed since last tick; else "idle" (keep "closed" when the session doesn't exist, from W6).
5. Retire the standalone busy-marker "working" trigger; remove "Waiting for" specifically (worst false-positive). If BUSY_MARKER_RE becomes unused, remove it; if used elsewhere, leave that use.
6. Preserve: stuck threshold, nudge ladder, brain, waiting_human/awaiting_decision detection, notifications. Only change WHAT counts as "working".
7. npx tsc clean.

Likely files: src/services/overmind-watcher.ts (classifier + tick: pass/track child hashes), tests/overmind-classifier.test.ts (regression).
Scope: the working/activity determination ONLY. Surgical. Don't change the nudge ladder or thresholds.

Tests (the regression that reproduces lkcamp):
- frozen coordinator pane (coordinatorHashPrev == current hash) containing "Waiting for ..." text + no mtime advance + no child change → status NOT working; after stuck threshold → "stuck". (THE key test.)
- changing coordinator pane → working.
- coordinator frozen but a child pane changed → overall working (don't nudge).
- both frozen, no mtime → stuck.
- parent_status: frozen coordinator with marker text → not "working".
- child status: frozen child with marker text → "idle"; changed child → "working"; missing session → "closed".
Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + overmind-watcher.ts (classifyWorkflow, parent/child classifiers, tick child capture, how last_pane_hash flows). Reply STATUS: PROPOSED with: exactly how you make "working" require change, the child-hash tracking mechanism, the 3 classifier edits, and the regression tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-O6/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: confirm a frozen workflow now goes stuck + the watcher would nudge.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O6 <STATE> <note>, THEN STATUS: <verb> -- reason.
