# 01 - Business Requirements Specification
## AGJAssist Plan06 - Telegram Mini App Terminal UX and Mobile Readability
**Version:** 1.0
**Date:** 2026-04-06
**Status:** Draft
**Author:** bsconsult
**Source:** code review of current tmux terminal implementation, Telegram Mini App UI, and saved UI evidence in `tmp/tmux.png` and `tmp/miniapp.png`

---

## 1. Project Snapshot

### Current State
| Area | What Exists |
|------|-------------|
| **Terminal frontend** | `xterm` loaded from CDN with `FitAddon`, `ResizeObserver`, dark theme, desktop-style left session tree, and an overlay status/disconnect control inside the terminal view. |
| **Telegram integration** | Telegram theme params are mapped into CSS variables, `Telegram.WebApp.expand()` is called during login, and the app uses a bottom tab bar inside the Mini App shell. |
| **Terminal backend** | Terminal output is not a real PTY stream. The server captures tmux pane snapshots on an interval and rewrites the terminal with `term.reset()` plus captured output. |
| **Resize behavior** | The frontend visually fits the xterm canvas, but it does not send terminal `cols` and `rows` to the backend, and the backend does not handle terminal resize messages. |
| **Mobile presentation** | On small screens, the terminal route stacks a session tree above a large terminal panel, uses desktop-tuned typography, and relies on `100vh`-style sizing that is brittle in Telegram WebView. |

### Desired State
| Area | Target |
|------|--------|
| **Wrapping accuracy** | Terminal output wraps to the actual visible mobile width because frontend fit and backend tmux sizing are synchronized. |
| **Telegram-native layout** | The terminal route behaves like a focused mobile tool, not a desktop admin screen compressed into a phone viewport. |
| **Terminal readability** | Terminal text is readable on handheld screens with appropriate font size, line height, and control placement. |
| **Session switching** | Mobile users can switch sessions quickly without permanently sacrificing vertical space to a left sidebar. |
| **Terminal controls** | Common mobile-only keys and terminal actions are reachable without fighting the system keyboard. |
| **Focused work mode** | Users can enter a full-screen terminal-chat experience inside the Mini App where the terminal UI owns the screen and a clear back action returns them to the previous app screen. |
| **Reliability** | Resize, reconnect, empty, and disconnected states are explicit and stable under Telegram viewport changes and orientation shifts. |

---

## 2. Current vs Desired Gap Analysis

### GAP-01: Visual fit exists without terminal-size propagation
- **Current:** `FitAddon.fit()` resizes the xterm viewport only.
- **Gap:** The active tmux target keeps rendering against stale dimensions, so long lines still wrap poorly.
- **Impact:** Mobile readability remains poor even though the canvas appears fitted.

### GAP-02: Snapshot redraw model reduces terminal fidelity
- **Current:** The backend polls tmux and sends pane snapshots; the frontend resets and rewrites terminal content.
- **Gap:** This breaks the feel of a live terminal, especially during resizing, scrolling, and reconnects.
- **Impact:** Mobile interactions feel jumpy and less trustworthy than a true streamed terminal.

### GAP-03: Telegram terminal layout is desktop-first
- **Current:** The terminal route uses the same structural assumptions as desktop, including sidebar-heavy layout and large fixed-height regions.
- **Gap:** Mobile users lose too much vertical space to chrome and list scaffolding.
- **Impact:** The terminal itself, which is the primary value surface, becomes secondary.

### GAP-04: Terminal controls sit on top of the canvas
- **Current:** Connection badge and disconnect button overlay the terminal viewport.
- **Gap:** These controls steal columns from already-constrained terminal content.
- **Impact:** Wrapping and scanability degrade further on narrow screens.

### GAP-05: Telegram viewport events are not part of terminal sizing
- **Current:** The app calls `expand()` but does not bind terminal layout recalculation to Telegram `viewportChanged`.
- **Gap:** Keyboard open/close, Telegram chrome changes, and dynamic viewport height changes are not handled explicitly.
- **Impact:** Height and wrapping may drift after layout changes.

### GAP-06: Mobile terminal typography is too compressed
- **Current:** The terminal uses `fontSize: 13` and `lineHeight: 1.1`.
- **Gap:** These settings are tuned for desktop density, not thumb-distance reading on a phone.
- **Impact:** Dense command output becomes hard to scan and error-prone.

### GAP-07: Mobile session switching lacks a compact pattern
- **Current:** Session navigation is presented as a full session tree.
- **Gap:** There is no condensed dropdown, drawer, or sheet pattern for small screens.
- **Impact:** Users must trade off access to sessions against access to the actual terminal.

### GAP-08: Mobile terminal-specific helper actions are missing
- **Current:** Users rely on the OS keyboard alone.
- **Gap:** No on-screen access to `Ctrl`, `Tab`, arrows, `Esc`, or paste-forwarding helpers.
- **Impact:** Real terminal usage on Telegram mobile is unnecessarily constrained.

### GAP-09: No focused full-screen terminal mode in Telegram
- **Current:** The terminal route still lives inside the normal Mini App shell with surrounding app chrome.
- **Gap:** There is no dedicated focused mode where the terminal-chat UI can temporarily own the screen.
- **Impact:** The user loses immersion and usable height, especially when they want to work in the terminal for longer stretches.

---

## 3. Core Business Objectives

| ID | Objective | Priority | KPI / Success Signal |
|----|-----------|----------|----------------------|
| BO-01 | Reduce horizontal scrolling and line truncation on mobile terminal usage | Must | Terminal sessions wrap correctly after load, resize, keyboard open, and orientation change |
| BO-02 | Make the Telegram terminal route usable as a primary mobile workflow | Must | User can open a session and work without needing to fight layout chrome |
| BO-03 | Preserve the existing tmux-based architecture for near-term improvement | Must | Phase 1 ships without a `node-pty` platform migration |
| BO-04 | Improve terminal readability and action reachability on phones | Must | Common tasks can be completed with readable text and reachable controls |
| BO-05 | Allow users to enter and exit a focused full-screen terminal-chat mode in Telegram | Must | User can open terminal full screen, work with minimal chrome, and return safely to the previous screen |
| BO-05 | Keep desktop terminal behavior stable while optimizing Telegram/mobile paths | Should | No regression in desktop session selection and terminal rendering |
| BO-06 | Establish a clean upgrade path if the snapshot model remains insufficient | Should | Architecture and implementation plan leave room for a future streaming upgrade |

---

## 4. Functional Logic Specification

### 4.1 Terminal Resize and Wrapping

#### FR-TERM-01: End-to-End Resize Contract
- The frontend must send a terminal resize message after the xterm viewport is fitted and whenever visible terminal dimensions materially change.
- Resize payload must include:
  - `type = "resize"`
  - `cols`
  - `rows`
  - optional `source` such as `init`, `resize-observer`, `viewport-changed`, or `orientation`
- Resize payloads with invalid or zero values must be ignored.

#### FR-TERM-02: Backend tmux Size Application
- The backend must accept `resize` messages on the tmux WebSocket channel.
- The backend must apply the requested dimensions to the active tmux window or equivalent target scope that governs line wrapping.
- The backend must not crash or terminate the session if resize application fails.
- If resize application fails, the backend must log the failure and keep the session usable.

#### FR-TERM-03: Initial Fit Sequence
- On terminal mount:
  1. xterm initializes
  2. `FitAddon.fit()` runs
  3. the terminal sends its `cols` and `rows`
  4. backend applies dimensions
  5. snapshot or live content is rendered using the new size
- This order is required to minimize incorrect first-paint wrapping.

### 4.2 Telegram Viewport Behavior

#### FR-TERM-04: Telegram Viewport Awareness
- The terminal route must react to Telegram viewport changes, including:
  - keyboard open/close
  - Mini App chrome changes
  - orientation change
  - viewport expansion state changes
- `100vh`-only sizing is not sufficient for Telegram terminal surfaces.
- The app must use Telegram or dynamic viewport measurements to derive terminal height.

#### FR-TERM-05: Stable Mobile Height Model
- Terminal container height must be derived from available viewport space after subtracting:
  - page header or route header
  - session selector bar
  - optional terminal action bar
  - bottom tab bar and safe area
- The terminal viewport must remain the tallest element on the route.

### 4.3 Mobile Layout and Navigation

#### FR-TERM-06: Mobile Session Switching Pattern
- On Telegram and narrow screens, the persistent session tree must be replaced by a compact selector pattern.
- Acceptable patterns:
  - select dropdown
  - bottom sheet
  - drawer or collapsible list
- The chosen pattern must preserve access to:
  - current session name
  - current pane target
  - connect/disconnect action
  - create session action when allowed

#### FR-TERM-07: Terminal-First Composition
- Status, metadata, and action controls must sit above or below the terminal, not on top of it.
- The terminal route must prioritize:
  1. active session identity
  2. terminal viewport
  3. secondary metadata and controls

#### FR-TERM-08: Empty, Loading, and Disconnected States
- Terminal UI must define explicit states for:
  - no session selected
  - terminal connecting
  - connected
  - disconnected
  - backend error
- Each state must communicate the next useful action.

#### FR-TERM-08A: Full-Screen Terminal-Chat Entry
- In Telegram Mini App mode, the user must be able to enter a focused full-screen terminal-chat view.
- Full-screen mode means:
  - terminal route chrome is reduced to the minimum required controls
  - the friendly terminal transcript and composer own the visible screen
  - non-essential surrounding app surfaces are hidden or collapsed
- Full-screen entry must preserve the active session or active conversation context.

#### FR-TERM-08B: Safe Exit and Return Path
- Full-screen mode must provide a clear back action.
- The back action must return the user to the previous app screen or previous terminal screen state without losing the current transcript.
- If Telegram `BackButton` integration is available, it should be used in addition to an in-UI back control.

### 4.4 Mobile Terminal Controls

#### FR-TERM-09: On-Screen Key Toolbar
- On Telegram mobile, the terminal route must expose an on-screen helper row for common terminal keys.
- Minimum key set:
  - `Ctrl`
  - `Esc`
  - `Tab`
  - `↑`
  - `↓`
  - `←`
  - `→`
- The toolbar may be collapsible, but it must be reachable without leaving the route.

#### FR-TERM-10: Clipboard and Paste Behavior
- Paste into terminal input must remain supported.
- If Telegram clipboard restrictions apply, the route must expose a clear fallback path such as a paste button or explicit instruction.

### 4.5 Typography, Theme, and Links

#### FR-TERM-11: Mobile Terminal Typography
- Mobile terminal typography must use a phone-readable scale:
  - font size target: `14px` to `15px`
  - line height target: `1.2` to `1.3`
- Final values may differ slightly by viewport width, but they must be driven by viewport or container width, not user-agent sniffing.

#### FR-TERM-12: Theme Alignment
- Terminal chrome surrounding the viewport must align with Telegram theme variables.
- The terminal text area may keep a dedicated terminal background, but surrounding controls must not visually drift from the app shell.

#### FR-TERM-13: URL Handling
- Terminal output should support clickable links when safe and technically feasible.
- Clicking a detected URL must not break terminal focus or trigger unexpected route changes.

---

## 5. Business Rules

1. Resize propagation is mandatory for mobile terminal UX; frontend-only fitting is not considered sufficient completion.
2. Phase 1 must improve the existing tmux architecture rather than replace it with a new PTY stack.
3. Desktop terminal workflows must remain supported; Telegram-specific improvements must be additive, not destructive.
4. Mobile UI chrome must not occupy columns inside the terminal viewport.
5. Mobile-specific tuning must be based on viewport and layout context, not brittle user-agent logic.
6. If tmux resize cannot be applied reliably in some cases, the UI must still remain functional and visibly degrade gracefully.
7. Terminal state changes must be explicit and legible under both light and dark Telegram themes.
8. Full-screen terminal-chat mode must never strand the user; there must always be an obvious route back.

---

## 6. TS Scenarios

**TS-601**: Initial mobile terminal fit uses actual visible width
- **Given**: a Telegram Mini App user opens the terminal route on a phone with an active tmux pane
- **When**: the terminal mounts and completes its initial fit cycle
- **Then**: the frontend sends non-zero `cols` and `rows`, the backend applies the size, and long terminal lines wrap to the visible viewport without requiring immediate horizontal scrolling
- **Priority**: Must-Have
- **Type**: Happy Path

**TS-602**: Telegram viewport change re-fits terminal after keyboard open
- **Given**: an active mobile terminal session is open in Telegram
- **When**: the system keyboard opens and Telegram emits a viewport change
- **Then**: the terminal recalculates layout, sends updated dimensions, and remains fully visible within the new viewport height
- **Priority**: Must-Have
- **Type**: Edge Case

**TS-603**: Orientation change preserves usable wrapping
- **Given**: a user has an active terminal session in portrait mode
- **When**: the device rotates to landscape
- **Then**: the terminal refits, updates backend dimensions, and content wraps to the new width without manual reload
- **Priority**: Must-Have
- **Type**: Edge Case

**TS-604**: Mobile session switching does not hide the terminal
- **Given**: multiple tmux panes are available
- **When**: the user opens the mobile session selector and chooses a new pane
- **Then**: the new session connects and the terminal remains the dominant visual surface on the route
- **Priority**: Must-Have
- **Type**: Happy Path

**TS-605**: Connecting and disconnected states are explicit
- **Given**: a user opens a tmux pane and the WebSocket is interrupted
- **When**: the connection drops
- **Then**: the UI shows a disconnected state outside the terminal canvas and presents a recovery action
- **Priority**: Must-Have
- **Type**: Error

**TS-606**: Overlay controls no longer steal terminal columns
- **Given**: a mobile terminal session is open on a narrow screen
- **When**: the user views the top of the terminal
- **Then**: status and disconnect controls are outside the text viewport and terminal columns are not reduced by overlaid chrome
- **Priority**: Must-Have
- **Type**: Happy Path

**TS-607**: On-screen helper keys support terminal workflows
- **Given**: a Telegram mobile user needs to send `Ctrl+C` or arrow-key navigation
- **When**: the user taps the helper toolbar
- **Then**: the correct control sequences are forwarded to the terminal session
- **Priority**: Should-Have
- **Type**: Happy Path

**TS-608**: Mobile typography remains readable in light theme
- **Given**: Telegram is running in a light theme
- **When**: the user opens the terminal route
- **Then**: surrounding terminal UI retains clear contrast, and terminal-adjacent text remains readable without washed-out hierarchy
- **Priority**: Should-Have
- **Type**: Accessibility

**TS-609**: Invalid resize payloads do not break the session
- **Given**: the frontend emits a malformed or zero-dimension resize event
- **When**: the backend receives it
- **Then**: the backend ignores the payload, logs the issue if needed, and leaves the tmux session connected
- **Priority**: Must-Have
- **Type**: Error

**TS-610**: Phase 1 ships without node-pty migration
- **Given**: the terminal improvement work is completed for Plan06
- **When**: the implementation is reviewed against scope
- **Then**: the app still uses the existing tmux-backed terminal architecture and the improvements are delivered through layout, resize, and UX changes
- **Priority**: Must-Have
- **Type**: Scope

**TS-611**: User can enter focused full-screen terminal-chat mode
- **Given**: a Telegram Mini App user is on a screen that offers terminal-chat access
- **When**: the user taps the full-screen terminal action
- **Then**: the app enters a focused terminal-chat view where the transcript and composer occupy the main visible space and non-essential surrounding chrome is hidden or collapsed
- **Priority**: Must-Have
- **Type**: Happy Path

**TS-612**: User can exit full-screen terminal-chat mode safely
- **Given**: the user is working in full-screen terminal-chat mode
- **When**: the user taps the back control or Telegram back button
- **Then**: the app returns to the previous screen or previous terminal state without losing the terminal transcript already shown
- **Priority**: Must-Have
- **Type**: Happy Path

---

## 7. Non-Functional and Quality Requirements

### Performance
- Initial terminal usable state on mobile should be reached within 1.5 seconds after route entry on local or LAN development conditions.
- Resize handling should visibly settle within 200 ms after viewport change events in normal conditions.

### Reliability
- Terminal route must survive reconnects, invalid resize payloads, and repeated viewport changes without requiring a full app reload.
- Resize handling must be idempotent and safe under bursty layout events.

### Security
- Existing auth token requirements on the tmux WebSocket must remain unchanged.
- New resize messages must not permit arbitrary command execution or target switching.

### Mobile Behavior
- Telegram WebView is a first-class environment, not a fallback browser.
- Safe-area and bottom tab bar collisions must be explicitly handled.

### Accessibility
- Non-terminal controls must retain visible focus styling and usable touch targets on mobile.
- Connection and state badges must not rely on color alone.

### Observability
- Resize failures and connection transitions should be observable in logs for debugging.

---

## 8. Assumptions, Risks, Dependencies, Open Questions

### Assumptions
- The team wants a phased improvement, not an immediate rewrite of the terminal backend.
- tmux window or pane dimensions can be adjusted sufficiently for phase-1 wrapping improvements.

### Risks
- The snapshot-rendering model may still feel inferior after resize fixes.
- tmux size control may behave differently depending on how panes and clients are attached.
- Telegram viewport behavior may vary across iOS and Android WebView implementations.

### Dependencies
- Frontend changes in `src/web/public/app.js` and `src/web/public/style.css`
- Backend tmux WebSocket changes in `src/tmux/tmux-stream-manager.ts` and `src/tmux/tmux-service.ts`
- Optional xterm addon integration for web links

### Open Questions
- Should the Telegram bottom tab bar stay visible during terminal usage, or should the terminal route enter a denser mode?
- Should mobile helper keys be always visible or collapsible?
- Is phase 2 expected to replace the snapshot model with a true streamed terminal contract?

---

## 9. Cross-Team Implications and Handoff Notes

- **Design:** deliver a terminal-first mobile route with compact session switching and non-overlaid controls.
- **Development:** implement resize propagation before styling polish, otherwise wrapping complaints will remain.
- **QA:** verify Telegram viewport changes, portrait/landscape transitions, and light-theme readability.
- **PM:** keep scope disciplined around phase-1 tmux-based improvement; treat architecture replacement as a separate decision.

---

## 10. Recommended Next Steps

1. Implement the resize contract end to end.
2. Refactor Telegram terminal layout to remove overlaid controls and persistent mobile sidebar usage.
3. Add mobile key helper actions and Telegram-aware height handling.
4. Reassess terminal fidelity after phase 1 and decide whether a later backend streaming redesign is justified.
