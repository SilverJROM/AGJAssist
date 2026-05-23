# Correction — O8 iter 1 (hasActiveTurn false-positive on the status bar)

LIVE VALIDATION FOUND: hasActiveTurn(pane) = /esc to interrupt/i.test(pane) matches the PERSISTENT BOTTOM STATUS BAR, not just a real active turn. Evidence: lkcamp-12 sits at an EMPTY composer (idle) but its bar is "⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ctrl+t to hide tasks" → hasActiveTurn=true → falsely WORKING. (HRIS correctly went waiting_human only because its bar showed "shells, monitors" with no "esc to interrupt".)

The REAL active-turn signal is the SPINNER line (e.g. "✻ Scurrying… (14s · ↑ 553 tokens · esc to interrupt)" or "◦ Working (9s • esc to interrupt)") — a line that has "esc to interrupt" AND is an in-progress spinner — NOT the bottom hint/status bar.

FIX (precise, in src/services/overmind-watcher.ts):
- hasActiveTurn(pane): return true only if SOME LINE contains "esc to interrupt" AND that line is NOT a status-bar chrome line. A status-bar line is one that ALSO contains any of: "ctrl+t", "bypass permissions", "to manage", "for agents", " shells", " monitors", "shift+tab". (i.e. the spinner line has "esc to interrupt" but none of those bar-only tokens.) Implement by splitting into lines and checking: lines.some(l => /esc to interrupt/i.test(l) && !/ctrl\+t|bypass permissions|to manage|for agents|\bshells?\b|\bmonitors?\b|shift\+tab/i.test(l)).
- Keep extractBody + the body-hash + WORKING = hasActiveTurn OR bodyChanged as-is.

Tests (add):
- pane whose ONLY "esc to interrupt" is in the bar line ("⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt · ctrl+t to hide tasks") + empty composer → hasActiveTurn=FALSE.
- pane with a spinner line "✻ Working… (5s · esc to interrupt)" → hasActiveTurn=TRUE.
- keep existing tests green.
Gate: targeted vitest + npx tsc + npm run build.

Append callback FIRST [projcore callback] O8 DONE <note> (after fix), THEN STATUS: DONE. Correction iter 1.
