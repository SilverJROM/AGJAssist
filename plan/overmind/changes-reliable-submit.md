# changes: reliable coordinator-message submit

## Problem

Overmind sends coordinator messages via `tmuxService.sendCommand` (send text + one Enter).
On Claude-Code / codex TUIs a long message is treated as a PASTE and a single Enter does NOT
submit it — the text sits in the composer (`❯ <text>`) until a human presses Enter again.
Result: nudges, demands, completeness requests, and completion consults stall silently in the
composer and the coordinator never receives them.

Reference: lead.md Rule 18 / CALLBACK_PROTOCOL — "press Enter ONE MORE TIME to promote paste → submit."

## Fix: `sendAndSubmit` with verify + re-Enter loop

### Algorithm (TmuxService.sendAndSubmit)

1. Send text literally (`send-keys -l -t <target> -- <text>`) as a separate `execFile` call.
2. Send first `C-m` (`send-keys -t <target> C-m`) as a second separate `execFile` call.
3. Loop up to 3 total C-m presses:
   - Sleep 500ms.
   - `capturePane` the target.
   - Check if text is still un-submitted:
     - Composer heuristic: last line starting with `❯` or `›` still contains the first ~40
       non-space chars of the text.
     - Paste indicator: pane contains `[Pasted Content` or `tab to queue`.
   - If un-submitted → send another `C-m` and increment counter.
   - If submitted (composer no longer holds the text) → return `true`.
4. After the 3rd press, do one final capturePane check and return result.
5. Cap: never more than 3 C-m presses. Returns `false` if still stuck.
6. Wrapped in try/catch — never throws. Validates target like `sendCommand`.

### Call sites switched (sendCommand → sendAndSubmit)

| File | Location | Message |
|---|---|---|
| `overmind-watcher.ts` | `applyNudgeLadder` | CANNED_NUDGE (Tier 1/2) |
| `overmind-watcher.ts` | `applyTier3Brain` (nudge verdict) | brain-generated nudge text |
| `overmind-watcher.ts` | `applyCompleteness` | completeness gap request |
| `overmind-watcher.ts` | `handleAllTasksDone` | completion consult |
| `overmind-watcher.ts` | `reconcile()` | registration gap demand |
| `overmind-routes.ts` | `/complete` child-close reminder | kill-session reminder |

Post-send `capturePane` + `hashPane` re-captures are PRESERVED at all switched call sites
so the nudge-anti-reloop hash still records the post-send pane state.

NOT switched (out of scope): `applyDecisionInterception` (two `sendCommand` calls for the
answer + correction note), TG `/tmux_send`, OVM chat relay.

## Tests

### New: `sendAndSubmit` unit tests (tmux-service.spec.ts)

- `setTimeout` from `node:timers/promises` mocked so tests run instantly.
- **Clean first capture** → returns `true` after 1 press; no extra C-m.
- **Stuck first capture, clean second** → re-presses Enter; returns `true`; exactly 2 C-m total.
- **Never clears (3 captures all stuck)** → returns `false` after exactly 3 C-m; no infinite loop.
- **execFile rejects** → returns `false` (no throw).
- **Paste indicator in first capture** → re-presses Enter; clean second → returns `true`.

### Updated: existing tests

All test mocks that construct a `TmuxService`-shaped object now include `sendAndSubmit: vi.fn(async () => true)`:
- `overmind-nudge.test.ts` — `makeTmuxMock` + inline mock
- `overmind-reconcile.test.ts` — `makeTmuxMock`
- `overmind-routes.test.ts` — `makeTmuxMock` (child-close tests)
- `overmind-brain.test.ts` — `makeTmuxMock`
- `overmind-stream.test.ts` — three inline tmux objects

All coordinator-send assertions updated from `sendCommand(target, msg, true, true)` to
`sendAndSubmit(target, msg)`. "Not called" assertions updated to `sendAndSubmit`.

`applyDecisionInterception` tests (`overmind-decision.test.ts`) retain `sendCommand` assertions —
that path is intentionally out of scope and still uses `sendCommand`.

## Build / test results

- `npx tsc --noEmit`: clean
- `npm run build`: clean
- `npx vitest run`: 310/310 passed (27 test files)
