# B12g Review

## Scope Check

- New warn-check is inside `isAttachShape` only.
- Legacy label+session register validation and persistence were not changed.
- No reject/422/404 behavior from B12f was changed.
- No nudge suppression, parent-orphaned handling, Telegram notification, or client UI scope was added.

## Diff Review

- The attach flow creates or upserts the workflow first, then performs the best-effort parent check.
- `isAgentPane()` is reused directly; no route-local pane classifier was introduced.
- Detector exceptions do not escape the route.
- `parent_warning` is response-only and present only for actionable warning states.
- The existing `parent_status` column is reused; no migration or schema version bump was needed.

## Risks

- Existing watcher statuses and B12g register statuses share `parent_status`. This is intentional per approved plan and can be overwritten by later runtime checks.

