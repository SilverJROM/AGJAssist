# Batch W2 Independent Validation

Requirement WU2:
"In the expanded card, present details (parent, child-working/active session, tier, elapsed, stuck, coordinator, children) as a compact 2-column table (label/value rows), mobile-friendly. Keep tasklist + history outside the table."

Validation:
- PASS: expanded detail metadata is rendered with a table structure in `src/web/public/app.js`.
- PASS: table rows include Coordinator, Children, Active, Tier, Elapsed, Total, and Stuck.
- PASS: Active uses `formatActiveSessionAttribution(workflow)`, preserving the existing active session + role attribution behavior.
- PASS: tasklist and history `<details>` blocks remain below and outside the table.
- PASS: `src/web/public/style.css` defines compact label/value table styling and a narrow-width stacked layout.

Gate:
- PASS: `npx tsc`.
- PASS: `npm run build`.

Residual risk:
- Visual confirmation in a live Telegram webview is still recommended because this batch validated the static UI structure and build output locally.
