# 04 - Implementation Plan
## AGJAssist Plan06 - Execution Plan for Terminal Resize and Telegram Mobile UX
**Version:** 1.0
**Date:** 2026-04-06
**Status:** Draft
**Author:** pmanager
**Input:** 01-business-requirements.md, 02-system-architecture.md, 03-ui-ux-plan.md
**Mode:** Standard

---

## 1. Pipeline Summary

Plan06 should execute in this order:
1. establish the resize contract
2. apply tmux-side geometry changes
3. add the friendly terminal-chat surface
4. add focused full-screen entry and exit behavior
5. refactor the Telegram terminal route layout
6. add mobile helper controls and state polish
7. validate on real narrow-screen behavior

This sequence matters. If layout polish ships before resize propagation, the main wrapping complaint will remain unresolved.

---

## 2. Snapshot

### Scope
- terminal route only
- tmux WebSocket terminal protocol only
- Telegram and narrow-screen UX only where it materially changes terminal usage
- friendly terminal-chat surface plus focused full-screen Mini App mode

### Non-Scope
- full backend replacement with `node-pty`
- broad redesign of the rest of the app shell
- deep conversation/chat UI changes outside terminal-specific shared layout concerns

### Success Definition
- mobile terminal wrapping improves materially because backend and frontend dimensions match
- Telegram terminal route becomes terminal-first and easier to operate on a phone
- user can enter a focused full-screen terminal-chat mode and return safely
- desktop terminal route remains functional

---

## 3. Critical Path

1. `resize` message support in WebSocket protocol
2. tmux size application service method
3. frontend geometry detection and resize emission
4. friendly terminal-chat command/result surface
5. full-screen route or state controller with safe back behavior
6. Telegram-aware terminal route height model
7. mobile session selector and header refactor
8. helper key toolbar and state polish
9. validation on real mobile-sized viewport behavior

---

## 4. Constraints and Override Mode

### Constraints
- must preserve current tmux-based backend for phase 1
- must not regress desktop terminal flow
- must avoid user-agent-based mobile logic where layout/context detection is enough
- must not leave terminal controls overlaid on the viewport

### Override Mode
- none
- prototype and post-implementation visual review remain required because this is user-facing UI work

---

## 5. Milestones

| # | Milestone | Packets | Gate |
|---|-----------|---------|------|
| M1 | Resize Foundation | P1, P2 | terminal sends and handles resize safely |
| M2 | Friendly Terminal-Chat Surface | P3, P4 | command/result UX works with real tmux backend |
| M3 | Telegram Focused Mode and Layout | P5, P6 | full-screen mode and terminal-first layout work |
| M4 | Controls and State Polish | P7 | helper actions and state treatments complete |
| M5 | Validation and Review | P8, P9 | targeted tests and visual checks pass |

---

## 6. Task Packets

### P1: Backend Resize Contract
**Goal:** Add explicit resize handling to the tmux WebSocket path.

**Files in scope**
- `src/tmux/tmux-stream-manager.ts`
- `src/tmux/tmux-service.ts`

**Inputs and dependencies**
- `01-business-requirements.md`
- no upstream code dependency beyond the current tmux terminal path

**Expected artifacts**
- `resize` message handling in `TmuxStreamManager`
- tmux sizing helper in `TmuxService`
- guard rails for invalid or zero dimensions

**Acceptance checks**
- [ ] backend accepts `{ type: "resize", cols, rows }`
- [ ] invalid dimensions are ignored safely
- [ ] resize failure does not close the session
- [ ] resize logic is isolated in a service helper, not scattered inline

**Stop conditions**
- tmux resizing proves impossible or destructive in the current model
- resize command strategy remains unstable after targeted validation

---

### P2: Frontend Geometry Emission
**Goal:** Ensure xterm sends correct geometry after fit and on relevant layout changes.

**Files in scope**
- `src/web/public/app.js`

**Inputs and dependencies**
- depends on P1 for full end-to-end validation

**Expected artifacts**
- terminal geometry helper function
- resize emission after initial fit
- deduped resize emission on actual geometry change
- Telegram and window event bindings where appropriate

**Acceptance checks**
- [ ] initial terminal mount sends non-zero `cols` and `rows`
- [ ] `ResizeObserver` changes can trigger geometry update
- [ ] Telegram viewport changes trigger geometry update
- [ ] unchanged geometry does not spam duplicate resize sends

**Stop conditions**
- geometry values are unstable or zero under normal route conditions

---

### P3: Friendly Terminal-Chat Surface
**Goal:** Add a chat-like terminal interaction mode that presents commands and terminal results more readably than raw xterm.

**Files in scope**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Inputs and dependencies**
- P2 recommended before finalizing layout so visible wrapping can be judged correctly

**Expected artifacts**
- friendly transcript-style terminal view
- bottom composer for command entry
- command/result grouping backed by tmux execution
- clearer empty, connecting, and disconnected states

**Acceptance checks**
- [ ] user can scroll a transcript-style terminal view easily
- [ ] user can type input in a bottom composer and send it for processing
- [ ] command and result presentation is easier to read than raw terminal paint
- [ ] empty and disconnected states include a next action

**Stop conditions**
- tmux-backed command/result grouping proves too lossy for the intended workflows

---

### P4: Raw/Friendly Mode Strategy
**Goal:** Preserve raw terminal access while making the friendly terminal-chat experience the default in Telegram.

**Files in scope**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Inputs and dependencies**
- P3

**Expected artifacts**
- default mode selection rules
- raw/friendly mode switch where needed
- active session continuity across modes

**Acceptance checks**
- [ ] Telegram defaults to friendly terminal-chat mode
- [ ] raw mode remains reachable for advanced use
- [ ] active session can be preserved when switching modes

**Stop conditions**
- the two-mode model becomes too confusing or duplicates too much state

---

### P5: Focused Full-Screen Terminal-Chat Mode
**Goal:** Let the user enter a full-screen terminal-chat experience in Telegram and return safely.

**Files in scope**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Inputs and dependencies**
- P3 and P4

**Expected artifacts**
- full-screen terminal-chat entry action
- previous-route or previous-state capture
- safe in-app back control
- Telegram `BackButton` integration if available

**Acceptance checks**
- [ ] user can enter full-screen terminal-chat mode
- [ ] full-screen mode hides or collapses non-essential chrome
- [ ] user can return to the previous screen safely
- [ ] transcript is not discarded on exit

**Stop conditions**
- full-screen mode creates unstable route restoration or state loss

---

### P6: Telegram Mobile Layout and Height Model
**Goal:** Replace brittle mobile terminal layout behavior with Telegram-aware sizing and compact session switching.

**Files in scope**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Inputs and dependencies**
- P3 through P5 for terminal/chat structure

**Expected artifacts**
- dynamic route height computation for terminal surface
- compact mobile session selector pattern
- reduced dependency on `100vh` and large mobile fixed min-heights

**Acceptance checks**
- [ ] mobile terminal route no longer stacks an oversized session tree above the viewport by default
- [ ] friendly terminal-chat surface remains dominant on narrow screens
- [ ] keyboard open/close and Telegram viewport changes do not break route sizing
- [ ] safe area and bottom tab bar collisions are handled

**Stop conditions**
- Telegram layout remains unstable after real viewport event handling

---

### P7: Mobile Helper Key Toolbar
**Goal:** Add practical on-screen terminal helper controls for Telegram mobile.

**Files in scope**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Inputs and dependencies**
- P3 through P6

**Expected artifacts**
- helper key bar component or inline terminal helper section
- control sequence forwarding for at least `Ctrl`, `Esc`, `Tab`, arrows

**Acceptance checks**
- [ ] helper keys are visible on Telegram mobile terminal route
- [ ] tapping helper keys forwards expected sequences
- [ ] controls do not overlap the bottom nav
- [ ] buttons meet mobile touch target sizing

**Stop conditions**
- helper inputs conflict with standard typing or break terminal focus

---

### P8: Typography, Theme, and Link Polish
**Goal:** Improve readability and finish route-level polish after structural fixes are in place.

**Files in scope**
- `src/web/public/app.js`
- `src/web/public/style.css`

**Inputs and dependencies**
- P3 through P7

**Expected artifacts**
- mobile terminal typography tuning
- stronger light-theme contrast for terminal-adjacent chrome
- optional web-links addon integration if low-risk in the current stack

**Acceptance checks**
- [ ] mobile terminal text is more readable than current baseline
- [ ] light Telegram theme retains usable contrast
- [ ] terminal-adjacent UI aligns with app theme variables

**Stop conditions**
- typography change unexpectedly reduces desktop readability or terminal fit accuracy

---

### P9: Test and Validation Packet
**Goal:** Validate resize semantics and mobile route behavior with targeted checks.

**Files in scope**
- `tests/unit/*` as needed
- terminal-related source files touched by implementation

**Inputs and dependencies**
- P1 through P6

**Expected artifacts**
- targeted backend unit tests for resize message handling and helper logic
- manual validation checklist for Telegram and narrow-screen behaviors

**Acceptance checks**
- [ ] resize helper logic has unit coverage where practical
- [ ] malformed resize payload behavior is validated
- [ ] manual checks cover TS-601 through TS-612 where automated coverage is not practical

**Stop conditions**
- resize correctness cannot be reproduced consistently

---

### P10: Final Review and Spec Update
**Goal:** Close the loop with visual review and documentation updates.

**Files in scope**
- `plan/plan06/*`
- any living project specification files only if implementation changes long-term architecture commitments

**Inputs and dependencies**
- implementation complete
- validation evidence available

**Expected artifacts**
- post-implementation visual review notes
- updated plan status and any implementation evidence summary

**Acceptance checks**
- [ ] no unresolved critical terminal UX findings remain
- [ ] remaining limitations are documented explicitly
- [ ] specification updates are made or skipped with reason

**Stop conditions**
- major mobile terminal regressions remain unresolved

---

## 7. Prototype Phase

### Requirement
Prototype phase is required because Plan06 changes layout, control placement, and mobile route behavior.

### Prototype target
- terminal route only
- no backend rewrite
- sufficient frontend and protocol wiring to demonstrate:
  - friendly terminal-chat transcript
  - full-screen entry and safe exit
  - terminal meta bar outside viewport
  - compact mobile session switcher
  - dynamic terminal height model
  - helper key toolbar

### Prototype validation chain
1. `jromhead` for customer-journey and responsive friction review
2. `webdesign` for design-quality validation
3. `bsconsult` for TS coverage check against Plan06 requirements

### Approval gate
- all critical issues resolved
- remaining minor issues explicitly scheduled

---

## 8. Final Implementation and Validation Milestones

### Final implementation milestone
- resize path merged
- friendly terminal-chat surface implemented
- focused full-screen terminal-chat mode implemented
- mobile terminal route refactored
- helper actions and theme polish completed

### Validation milestone
- targeted unit coverage complete
- manual Telegram viewport checks complete
- desktop regression check complete

---

## 9. Post-Implementation Visual Review

### Reviewer
- `jromhead`

### Required checks
- terminal-first hierarchy on Telegram
- full-screen mode feels immersive and reversible
- no viewport overlay controls
- session switching on mobile is compact and usable
- long wrapped output or long transcript results are readable
- light-theme route remains legible

### Gate
- no critical findings
- major findings fixed or explicitly escalated

---

## 10. Commands and Evidence Expectations

Implementation completion should include:
- changed files list
- commands run
- test results
- manual validation notes for:
  - Telegram keyboard open/close
  - portrait/landscape
  - reconnect
  - long command output wrapping
  - full-screen entry and return path

---

## 11. Post-Implementation Spec Update Instructions

If implementation materially changes terminal architecture assumptions, update the living project specification to reflect:
- tmux resize support
- Telegram terminal route behavior
- any known terminal transport limitations that remain

If no architectural commitments change beyond Plan06 scope, note that no project-wide spec update was required.
