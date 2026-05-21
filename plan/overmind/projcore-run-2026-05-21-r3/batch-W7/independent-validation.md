# Batch W7 Independent Validation

- Verified `statusColor()` now maps the WU7 unified scheme:
  - working = green
  - idle/active = yellow
  - waiting_human/awaiting_decision = blue
  - stuck/failed = red
  - completed/paused/closed = grey
- Verified the active/completed workflow card header now renders display name, rename control, collapse chevron, and colored overall status badge.
- Verified the expanded card now includes sub-status with `task#<id/index>` plus a current-task description line.
- Verified the detail table now uses the required parent/child, status/status, Elapsed/Total, and Tier/Stuck four-column layout.
- Verified per-session status cells render through `statusColor()`, with child `closed` statuses using grey.
- Verified zero-child workflows render `child` as `n/a`.
- Verified the inline per-card History details block was removed from active/completed cards and the separate History tab code remains present.
- Verified the required gate commands passed: targeted Vitest, `npx tsc`, and `npm run build`.
