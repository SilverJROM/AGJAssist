# 02 - System Architecture Specification
## AGJAssist Plan06 - Terminal Resize, Telegram Viewport, and Mobile Terminal Architecture
**Version:** 1.0
**Date:** 2026-04-06
**Status:** Draft
**Author:** sysarch
**Input:** 01-business-requirements.md

---

-> Target Architecture Proposal:

## 1. Architecture Snapshot

Plan06 should preserve the current stack and improve the weakest link first: terminal size coordination. The correct phase-1 target is not a `node-pty` migration. It is an end-to-end resize-aware tmux terminal with a Telegram-native mobile shell.

Primary recommendation:
- keep `xterm` on the frontend
- keep tmux as the backend terminal authority
- add a resize contract over the existing WebSocket
- apply requested dimensions to the tmux target
- add a friendly terminal-chat surface backed by tmux command/result exchanges
- support a focused full-screen terminal-chat route or route state in Telegram
- refactor Telegram terminal layout so the terminal surface owns the route

Fallback recommendation:
- if wrapping and fidelity are still unacceptable after phase 1, plan a dedicated phase-2 terminal transport redesign

---

## 2. Input Analysis

### Existing Repo Reality
- Frontend is a no-build Preact + `htm` app served from `src/web/public`
- Telegram Mini App shell is already present
- Terminal frontend already loads `xterm` and `FitAddon`
- Backend terminal implementation is tmux-backed and snapshot-driven, not PTY-stream-driven

### Critical Architectural Constraint
- The team needs a pragmatic improvement path inside the current codebase
- A complete terminal backend rewrite would be a materially larger scope than the requested UX correction

---

## 3. Current State Assessment

### Current Frontend Path
1. Terminal route mounts `TerminalView`
2. `xterm` instance is created
3. `FitAddon.fit()` runs
4. WebSocket connects to `/ws/tmux/:target`
5. backend sends pane snapshots
6. frontend resets terminal and writes latest snapshot

### Current Backend Path
1. tmux target is validated
2. initial pane capture is sent
3. interval polling captures pane repeatedly
4. input keystrokes are forwarded through `tmux send-keys`
5. no resize message is handled

### Architecture Defect
- The frontend and backend disagree about terminal dimensions
- xterm fit changes the canvas, but tmux output generation is not resized to match

---

## 4. Guiding Decisions

### Decision A: Preserve tmux-backed architecture for phase 1
- **Why:** fastest path to user-visible improvement with limited churn
- **Trade-off:** terminal fidelity remains bounded by snapshot-based transport

### Decision B: Introduce an explicit resize message in the terminal protocol
- **Why:** wrapping correctness depends on both client and server sharing the same geometry
- **Trade-off:** requires tmux-specific resize handling and testing under multiple layout conditions

### Decision C: Treat Telegram viewport events as first-class layout signals
- **Why:** Telegram WebView height is dynamic and `100vh` is not a reliable terminal sizing source
- **Trade-off:** more event wiring and height bookkeeping in the frontend

### Decision D: Separate chrome from terminal text viewport
- **Why:** overlay controls reduce useful columns and degrade scanability on mobile
- **Trade-off:** requires a small layout redesign of the terminal route

### Decision E: Keep desktop sidebar behavior and add a mobile-specific selector pattern
- **Why:** desktop and Telegram needs differ materially
- **Trade-off:** adds conditional UI logic but avoids degrading desktop usability

### Decision F: Introduce a Telegram-focused full-screen terminal-chat mode
- **Why:** the user wants an immersive work mode with easier scrolling and typing, closer to chat rhythm than raw terminal paint
- **Trade-off:** requires route/state management and a clear back-navigation contract

---

## 5. High-Level Architecture Diagram

```text
┌───────────────────────────────────────────────────────────────────┐
│ Telegram Mini App / Browser                                       │
│                                                                   │
│  Terminal Surfaces                                                │
│  ├─ Friendly terminal-chat view                                   │
│  │  ├─ session/header bar                                         │
│  │  ├─ transcript list                                            │
│  │  ├─ composer                                                   │
│  │  └─ helper key row                                             │
│  └─ Raw terminal view                                             │
│     ├─ session selector (desktop sidebar / mobile compact selector)│
│     ├─ terminal meta bar                                          │
│     ├─ xterm viewport + FitAddon                                  │
│     └─ mobile helper key bar                                      │
│                                                                   │
│  Full-screen controller                                           │
│  ├─ enter full-screen friendly mode                               │
│  ├─ hide non-essential shell chrome                               │
│  └─ restore previous route or state on back                       │
│                                                                   │
│  Layout signals                                                   │
│  ├─ ResizeObserver                                                │
│  ├─ window resize / orientation change                            │
│  └─ Telegram viewportChanged                                      │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                │ WebSocket `/ws/tmux/:target`
                                │
                 ┌──────────────▼────────────────┐
                 │ Fastify + TmuxStreamManager   │
                 │                               │
                 │ Message types                 │
                 │ ├─ input                      │
                 │ ├─ resize                     │
                 │ ├─ ping/pong                  │
                 │ └─ snapshot / closed / error  │
                 └──────────────┬────────────────┘
                                │
                                │ tmux command execution
                                │
                 ┌──────────────▼────────────────┐
                 │ TmuxService                   │
                 │ ├─ capturePane                │
                 │ ├─ sendInput                  │
                 │ └─ applyTerminalSize          │
                 └──────────────┬────────────────┘
                                │
                                ▼
                           tmux session/window
```

---

## 6. Component Breakdown

### Frontend Components

#### TerminalView
- owns xterm lifecycle
- computes effective geometry after fit
- sends resize events when geometry changes
- renders connection and error states outside the terminal canvas

#### TerminalLayoutController
- derives terminal height from:
  - viewport height
  - route chrome
  - Telegram tab bar
  - safe area
- responds to Telegram `viewportChanged`, `window.resize`, and orientation changes

#### SessionSelector
- desktop mode: existing left tree pattern remains
- mobile mode: compact selector, drawer, or sheet pattern

#### FriendlyTerminalChatView
- default Telegram-friendly terminal experience
- renders transcript-style command/result exchanges
- keeps typing simple with a bottom composer
- supports full-screen focused mode

#### FullScreenTerminalController
- stores the previous route or screen state
- switches into focused terminal-chat mode
- integrates with Telegram back button when available
- restores previous state on exit without discarding transcript UI state

#### MobileKeyToolbar
- visible only for narrow-screen Telegram route
- emits terminal control sequences without modifying session state

### Backend Components

#### TmuxStreamManager
- parses inbound resize messages
- validates `cols` and `rows`
- deduplicates no-op resize requests when possible
- delegates valid resize requests to `TmuxService`

#### TmuxService
- adds `applyTerminalSize(target, cols, rows)` or equivalent API
- maps pane target to tmux window/session scope
- applies dimensions with the least destructive tmux command sequence available
- logs failures without dropping the session

---

## 7. Data and Flow Critical Paths

### 7.1 Initial Terminal Connect

```text
User opens terminal route
  -> TerminalView mounts
  -> xterm opens and fit runs
  -> geometry is measured
  -> WebSocket connects
  -> resize message sent with cols/rows
  -> backend applies tmux size
  -> backend sends snapshot
  -> snapshot is rendered using matched dimensions
```

### 7.2 Telegram Viewport Change

```text
Telegram keyboard opens or viewport changes
  -> Telegram viewportChanged event fires
  -> layout controller recalculates available height
  -> xterm fit runs
  -> geometry is compared against previous cols/rows
  -> if changed, resize message is sent
  -> backend applies tmux size
  -> next snapshot arrives with improved wrapping
```

### 7.3 Full-Screen Terminal-Chat Entry

```text
User taps "Open full screen"
  -> current route/state is stored
  -> app enters focused terminal-chat mode
  -> Telegram BackButton is shown when available
  -> non-essential shell chrome is hidden or collapsed
  -> transcript and composer become primary visible surfaces
```

### 7.4 Full-Screen Exit

```text
User taps in-app back or Telegram back button
  -> focused mode exit handler runs
  -> previous route/state is restored
  -> active transcript state remains available
```

### 7.5 Mobile Session Switch

```text
User opens compact session selector
  -> selects new target
  -> current WebSocket closes
  -> new TerminalView instance connects
  -> initial fit and resize contract run
  -> target metadata updates
  -> terminal becomes primary visible surface again
```

---

## 8. Non-Functional Mapping

| Requirement | Mechanism |
|------------|-----------|
| **Mobile readability** | terminal-first route layout, mobile typography scale, no overlay controls |
| **Focused work mode** | dedicated full-screen controller with previous-route restoration and Telegram BackButton integration |
| **Wrapping accuracy** | explicit WebSocket resize contract plus backend tmux size application |
| **Reliability** | invalid resize guards, safe logging, idempotent resize handling, disconnect states |
| **Security** | reuse existing auth token flow; resize messages affect geometry only |
| **Performance** | dedupe repeated resize values; avoid unnecessary resize calls on unchanged geometry |
| **Maintainability** | add clear helper functions for geometry calc and tmux target parsing instead of embedding logic in route handlers |
| **Observability** | log resize failures, rejected payloads, and connection transitions |

---

## 9. Trade-off Matrix

| Option | Cost | Delivery Speed | UX Gain | Complexity | Recommendation |
|--------|------|----------------|---------|------------|----------------|
| **A. Patch existing tmux snapshot architecture with resize + mobile layout** | Low-Medium | High | High for wrapping and route usability | Medium | Primary |
| **B. Migrate terminal backend to `node-pty` now** | High | Low | Potentially very high | High | Reject for phase 1 |
| **C. Hybrid output view using `<pre>` for logs and xterm only for prompt** | Medium | Medium | Medium for read-heavy flows, weak for true terminal use | Medium | Fallback only for limited workflows |

### Ranked Recommendation
1. **Option A** now
2. Evaluate actual user pain after A ships
3. Only then consider B if fidelity still blocks usage

---

## 10. Risks, Mitigations, Evolution Plan

### Risk 1: tmux resize behavior may be inconsistent
- **Mitigation:** implement a narrow service layer around tmux sizing; keep the command strategy swappable
- **Fallback:** if pane-level sizing is unreliable, resize at session/window scope and document the constraint

### Risk 2: Snapshot transport may still feel jumpy
- **Mitigation:** fix resize first, then assess remaining pain with real device validation
- **Evolution:** phase 2 can replace polling snapshots with a more faithful streaming model

### Risk 3: Telegram viewport events may be noisy
- **Mitigation:** debounce or dedupe layout-triggered resize operations by actual geometry change

### Evolution Path

#### Phase 1
- end-to-end resize contract
- friendly terminal-chat surface
- Telegram-aware height handling
- focused full-screen terminal-chat mode
- mobile session selector
- helper key toolbar
- terminal-first route composition

#### Phase 2
- reduce full-terminal resets where feasible
- investigate incremental output application
- evaluate whether snapshot transport remains acceptable

#### Phase 3
- if still needed, plan a transport-layer terminal redesign as separate scoped work

---

## 11. Collaboration Handoff Notes

### Business consultant
- protect scope discipline: phase 1 is a usability and layout correction inside current architecture

### Designer
- mobile terminal route must prioritize viewport height and visual hierarchy over card chrome

### Developer
- implement resize semantics before cosmetic polish
- avoid user-agent branching; prefer width and Telegram context checks
- isolate tmux resize logic in service methods

### Tester
- prioritize Telegram real-device checks:
  - keyboard open/close
  - portrait/landscape
  - reconnect
  - long command output

### PM
- define success as improved mobile usability and wrapping, not full terminal transport replacement
