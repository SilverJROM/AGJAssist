Batch-W2: Expanded-detail 2-column table

Batch ID: W2
Requirements: og-requirements-r3.md (WU2)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

Context: the expanded workflow card currently shows detail fields in a loose layout. WU2: present them as a compact 2-column label/value table.

Requirement (WU2): "In the expanded card, present details (parent, child-working/active session, tier, elapsed, stuck, coordinator, children) as a compact 2-column table (label/value rows), mobile-friendly. Keep tasklist + history outside the table."

Expected (acceptance):
1. Expanded card detail = a 2-col table: rows for Coordinator, Children, Active (who's working: active_session + role from RU3), Tier, Elapsed (current, from W5), Total, Stuck (stuck_since duration or —). 
2. Clean label/value rows, density-light, mobile-friendly (stacks fine on narrow Telegram webview). Use style.css classes.
3. Tasklist + History stay OUTSIDE/below the table (unchanged).
4. npx tsc clean.

Likely files: src/web/public/app.js (expanded detail → table), src/web/public/style.css (table styles). Maybe a tiny pure helper for the rows.
Scope: detail table layout ONLY. Don't change data/backend or other features. Surgical.
Tests: if you extract a pure rows-builder helper, test it; otherwise this is presentational — note in test-report. Run tsc + npm run build.

Plan handshake (MANDATORY): read brief + app.js (expanded card) + style.css. Reply STATUS: PROPOSED with the table structure + rows + styling. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tsc + npm run build + any helper test). Artifacts batch-W2/changes.md + test-report.md + independent-validation.md.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md [projcore callback] W2 <STATE> <note>, THEN STATUS: <verb> -- reason.
