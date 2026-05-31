# issue-005 Changes

## Branch: `feat/coord-notes-save-issue-005`

Cut from `feat/coord-notes-save-issue-001` @ `8fea831`.

## User Report

"update the notes, to show the date last changed for the notes on the right side as a sub detail"
Clarified: "date and time" and "put it below the title"

Expected:
1. The sub-detail below each note title shows a full "MMM D, h:mm AM/PM" format — e.g. "May 30, 2:30 PM", "May 29, 11:45 AM".
2. Both date AND time are always visible, regardless of how old the note is.
3. No other layout changes — date stays below the title in the existing ios-note-date span.

## Root Cause

Feature addition. `relativeDate()` at `app.js:2675` conditionally returned relative labels (time-only for today, "Yesterday", weekday name, or "May 26" with no time) — neither date nor time was consistently shown. The display span (`ios-note-date`) was already in place; only the formatter needed replacing.

## Code Changes

- `src/web/public/app.js:2675-2686` — Replaced `relativeDate()` body: removed all conditional relative-label branches; now unconditionally returns `toLocaleDateString({ month: 'short', day: 'numeric' }) + ', ' + toLocaleTimeString({ hour: '2-digit', minute: '2-digit' })` — always "MMM D, h:mm AM/PM".

## Verification

- Build: N/A (plain JS, no tsc)
- DEV deploy: http://localhost:3101 (cp dist + pm2 restart agjassist — online, pid 1516931)
- Smoke walk:
  - Opened: http://localhost:3101 (notes list)
  - Expected: each note row shows "May 30, 2:30 PM" style below the title in ios-note-date span

## Caveats

- [PRE-EXISTING] Locale formatting depends on the browser locale. The "2-digit" hour format will show "02:30 PM" on some locales and "2:30 PM" on others — consistent with prior behavior in the existing toLocaleTimeString calls already in the file.
