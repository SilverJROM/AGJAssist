# Batch W2 Changes

User Report verbatim:
"W2 = expanded-card detail as a compact 2-col table (coordinator/children/active/tier/elapsed/total/stuck); tasklist+history stay outside. UI only."

Root Cause mechanism:
The expanded workflow card rendered its detail metadata as a responsive card grid. That layout was looser than WU2 requires and did not present the expanded details as a compact label/value table.

Changes:
- `src/web/public/app.js`: replaced the expanded-card metadata grid with a compact two-column table. Rows are Coordinator, Children, Active, Tier, Elapsed, Total, and Stuck.
- `src/web/public/app.js`: moved the existing active-session attribution into the table's Active row and kept tasklist and history below the table.
- `src/web/public/style.css`: replaced the metadata-grid styles with compact table styling, including narrow-width stacking for Telegram webview friendliness.

Tests:
- No helper was extracted, so no helper unit test was added.
- `npx tsc`
- `npm run build`

Autonomous decisions: none.
