Batch-W7: Restructured detail card + unified color scheme + remove inline history

Batch ID: W7
Requirements: og-requirements-r3.md (WU7)
Branch: feat/overmind (CONTINUE). UI only (no schema).
Estimated: SHORT.

Context: W6 added parent_status + child_statuses (per-session). W7 restructures the expanded card to use them, unifies the color scheme, and removes the inline history block.

Target card layout (expanded):
```
> <display_name ?? label>            ✏️(rename)    ▸ [overall status badge]
  task#<n>: <current_task>
  <task description — e.g. the current task's label/detail>

  parent: <coordinator_session>     |  child: <child session, or n/a if none>
  status: <parent_status>           |  status: <child_status, or 'closed'>
  Elapsed: <current>                |  Total: <total>
  Tier: <n>                         |  Stuck: <dur or —>

  ▸ Tasks <done>/<total>   (collapsible, unchanged)
```

Expected (acceptance):
1. UNIFIED color scheme — REPLACE the current statusColor mapping (was working=yellow). New: 🟢 green = working; 🟡 yellow = idle/active; 🔵 blue = waiting_human + awaiting_decision (needs you); 🔴 red = stuck + failed; ⚪ grey = completed + paused + 'closed'. Update statusColor() in overmind-helpers.js + the CSS color classes (add ovm-blue; recolor ovm-green/yellow). Apply to the overall badge AND the per-session status cells.
2. Card structure:
   - Header: name (display_name ?? label) + ✏️ rename control (existing) + collapse chevron + overall status badge (colored).
   - Sub-status under header: "task#<index or id>: <current_task>" + a description line (the current task's detail; if you have the tasks array, use the processing task's label as the description, else current_task).
   - 4-col grid (reuse the W2 detail-table styling) with these rows:
     - parent: <coordinator> | child: <first child session, or "n/a" if no child>
     - status: <parent_status colored> | status: <child_status colored, "closed" if closed>
     - Elapsed: <current> | Total: <total>
     - Tier: <tier> | Stuck: <stuck dur or —>
   - (If multiple children, show the first in the grid + list the rest compactly, or join — keep simple; n/a only when zero children.)
   - Tasks collapsible (unchanged).
3. REMOVE the inline per-card History block/details (the History TAB from WU4 stays — only delete the in-card history rendering).
4. Per-session status cells use statusColor for their dot/text color. "closed" → grey.
5. npx tsc clean.

Likely files:
- src/web/public/overmind-helpers.js (statusColor remap + ovm-blue; helper for child display incl n/a/closed)
- src/web/public/app.js (card header + sub-status + new grid using parent_status/child_statuses; remove inline history)
- src/web/public/style.css (ovm-blue; recolor; grid tweaks)
- tests: statusColor new mapping (working→green, idle→yellow, waiting_human/awaiting_decision→blue, stuck/failed→red, completed/paused/closed→grey)

Scope: card restructure + unified colors + remove inline history ONLY. Don't touch backend/tabs/W6 data. Frontend. Surgical. Density-light, mobile-friendly (Telegram webview).

Tests: statusColor mapping (incl blue + closed→grey). Run vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + og-requirements-r3 (WU7) + app.js (current expanded card from W2 + inline history) + overmind-helpers.js (statusColor) + style.css. Reply STATUS: PROPOSED with the statusColor remap, the new card structure, child n/a/closed handling, history removal, tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (test + tsc + npm run build). Artifacts batch-W7/changes.md + test-report.md + independent-validation.md.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md [projcore callback] W7 <STATE> <note>, THEN STATUS: <verb> -- reason.
