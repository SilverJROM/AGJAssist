Batch-O7: URGENT — "working" must mean SUBSTANTIVE change (normalize timers/spinner/chrome before hashing)

Batch ID: O7
Requirements: og-requirements-ovm.md (OU6/OU7 — activity = real progress)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

LIVE EVIDENCE (HRIS, tagged "working" while actually idle/stuck): the parent (hris-d-22) is frozen with an EMPTY composer (idle). The child (hrcdx) "changes" every few seconds ONLY because of a ticking timer + spinner glyph:
  "◦ Waiting for background terminal (11m 13s • esc to interrupt) · 2 background terminals running · /ps to view"
  "• Waiting for background terminal (11m 16s • esc to interrupt) · 2 background terminals running · /ps to view"
Same message for 11+ minutes — only "(11m 13s→16s)" + the leading glyph (◦/•) differ. So the current hash-change logic (O6) sees childPaneHashChanged=true → "working" forever. WRONG: nothing SUBSTANTIVE is progressing.

THE FIX: before computing the change-hash (for BOTH coordinator and child panes, used by the working/stuck + parent/child classification), NORMALIZE OUT the time-based + animation + chrome noise, so two captures that differ ONLY by ticking timers/spinners hash IDENTICALLY (→ frozen → not working). Add a pure helper, e.g. normalizePaneForActivity(text):
- Remove elapsed-time counters: patterns like "(12s", "(11m 16s", "1h 2m 3s", " 16s •", "Ns ·", "Nm Ns" — strip any `\(?\b\d+h\b`/`\b\d+m\b`/`\b\d+s\b` duration tokens (and the surrounding "(", "•", "·").
- Remove token/counter noise: "↑ 553 tokens", "N tokens", "2 background terminals running" (the count), "N shells, N monitors".
- Remove leading spinner/animation glyphs per line: ◦ • ✻ ✶ ✢ ● ○ ⎿ ⠋⠙⠹ etc. (the rotating chars).
- Remove the persistent bottom status/hint bar lines: containing "bypass permissions", "ctrl+t to hide", "to manage", "← for agents", "↓ to manage", "/ps to view", "/stop", "esc to interrupt" (as a standalone hint), and any HH:MM:SS clock.
- Collapse runs of whitespace; trim. THEN hash the normalized text.
Apply this normalized hash everywhere the activity/change comparison happens (coordinator hash stored in last_pane_hash should be the NORMALIZED hash; child hash tracking likewise). Net rule: "working" ⟺ NORMALIZED coordinator pane changed OR NORMALIZED child pane changed OR run_dir mtime advanced. A pane whose only delta is a ticking timer/spinner → NOT working → accrues stuck → nudged. (Nudges are safe; a coordinator on a legit-long-but-silent background process will just confirm it's fine when nudged — far better than never detecting a hang.)

Expected acceptance:
1. normalizePaneForActivity(text) pure helper (exported, node-testable) that strips timers/glyphs/counters/chrome + collapses whitespace.
2. The classifier (overmind-watcher.ts) uses the NORMALIZED hash for coordinator + child change detection (replace the raw hashPane used for the activity comparison). last_pane_hash stores the normalized hash.
3. Net behavior unchanged otherwise (stuck threshold, nudge ladder, brain, waiting/decision detection, parent/child statuses).
4. npx tsc clean.

Tests (regression that reproduces HRIS):
- normalizePaneForActivity: two strings differing only by "(11m 13s" vs "(11m 16s" and "◦" vs "•" → normalize to IDENTICAL. A string with real new content → normalizes differently.
- classifier: a child pane that differs only by a ticking timer across ticks → NOT working → after threshold stuck. A pane with substantive new output → working.
- the existing 19 classifier tests stay green.
Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + overmind-watcher.ts (hashPane + where coordinator/child hashes are computed + compared). Reply STATUS: PROPOSED with the normalize helper's strip list, where the normalized hash replaces the raw hash, and the regression tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate. Artifacts batch-O7/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: after deploy, HRIS (currently substance-frozen) must flip to NOT-working (idle/stuck) within ~2 ticks — that is the confidence check JROM wants.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O7 <STATE> <note>, THEN STATUS: <verb> -- reason.
