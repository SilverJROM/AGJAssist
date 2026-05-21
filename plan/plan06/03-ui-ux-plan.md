# 03 - UI/UX Design Plan
## AGJAssist Plan06 - Telegram Terminal Experience and Mobile-First Readability
**Version:** 1.0
**Date:** 2026-04-06
**Status:** Draft
**Author:** webdesign
**Input:** 01-business-requirements.md, 02-system-architecture.md

---

-> Proposed direction:
Build the terminal route as a pocket control console with a friendly terminal-chat mode: focused, compact, and calm, with the transcript/composer treated as the product and a full-screen option for deep work.

## 1. First Impression

### Current Impression
- Functional and developer-oriented
- Desktop shell patterns survive into Telegram without enough adaptation
- The route feels like an internal admin view compressed into a phone

### Target Impression
- Intentional and terminal-first
- Compact, high-clarity control surfaces
- Chat-like rhythm for command and response
- Strong hierarchy with minimal wasted chrome

---

## 2. Hierarchy Analysis

### First-read hierarchy
1. active session identity
2. terminal viewport
3. status and key actions

### Second-read hierarchy
1. current pane target
2. connection state
3. session switch affordance

### Third-read hierarchy
1. create/disconnect actions
2. helper key toolbar
3. secondary metadata

### Current hierarchy problem
- The sidebar, badges, and overlaid controls compete with the terminal itself
- On mobile, too much height is spent on selectors and shell chrome before the user reaches the actual terminal

---

## 3. Issues Ranked by Impact

### Critical
1. Terminal controls overlay the text viewport, costing columns on the exact screens where columns are scarce.
2. Mobile session navigation uses a desktop sidebar mental model and takes too much vertical space.
3. There is no focused full-screen mode for terminal work inside Telegram.
4. Terminal typography is too compressed for Telegram handheld use.

### Major
5. Height composition is not Telegram-native and risks unstable viewport sizing.
6. Empty and disconnected states are technically present but not action-oriented enough.
7. Surrounding route chrome visually reads as generic admin UI instead of focused terminal tooling.

### Minor
8. Status badges rely too heavily on color.
9. Mobile helper actions for terminal control sequences are missing.
10. Focus states for non-input controls need stronger definition.

---

## 4. Design Intent and Mood

### Mood
Quiet, precise, infrastructure-grade.

### Visual Intent
- preserve the app's dark technical tone
- reduce visual clutter around the terminal
- make Telegram mobile feel purpose-built rather than merely supported

---

## 5. Layout Blueprint

### 5.1 Desktop Terminal Route

```text
┌─────────────────────────────────────────────────────────────────┐
│ Session sidebar │ Terminal meta bar                            │
│                 ├───────────────────────────────────────────────┤
│ Sessions list   │ target     status     actions                │
│                 ├───────────────────────────────────────────────┤
│                 │                                               │
│                 │               xterm viewport                  │
│                 │                                               │
│                 ├───────────────────────────────────────────────┤
│                 │ optional helper row / footer                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Telegram Mobile Terminal-Chat Route

```text
┌─────────────────────────────────────────────┐
│ Back   Terminal Chat        status          │
│ Session selector / target summary          │
├─────────────────────────────────────────────┤
│                                             │
│        transcript of command/result         │
│        scrollable, readable, grouped        │
│                                             │
│                                             │
├─────────────────────────────────────────────┤
│ message / command composer                  │
├─────────────────────────────────────────────┤
│ Ctrl  Esc  Tab  ←  ↑  ↓  →                 │
└─────────────────────────────────────────────┘
                Telegram bottom nav
```

### Layout rule
- The terminal viewport must be the single largest region on the screen.
- No control should float on top of terminal text.
- In full-screen mode, the terminal-chat transcript and composer must be the dominant visible surfaces.

### 5.3 Full-Screen Mode

In Telegram, the user should be able to enter a focused full-screen terminal-chat mode.

Full-screen mode should:
- hide or collapse non-essential shell chrome
- preserve a small top bar with:
  - back action
  - current session or terminal title
  - status
- keep the composer pinned at the bottom
- preserve the transcript scroll position sensibly

---

## 6. Typography Reasoning

### Terminal text
- Desktop may keep dense defaults.
- Telegram mobile should move to approximately:
  - `font-size: 14px` to `15px`
  - `line-height: 1.2` to `1.3`

### Supporting text
- Session labels and metadata should stay in the `11px` to `12px` range.
- Terminal-adjacent labels must remain readable in light Telegram themes.

### Reasoning
- Terminal content is scan-heavy, not decorative.
- The current `13px / 1.1` pairing is too compressed on a phone, especially for logs, wrapped commands, and stack traces.

---

## 7. Color and Contrast Reasoning

### Current direction
- The terminal background already works well as a dedicated dark canvas.
- The problem is mostly in surrounding chrome and light-theme hierarchy.

### Proposed color behavior
- Keep the terminal viewport itself on a stable dark surface for consistency.
- Bring surrounding bars and controls into stronger alignment with Telegram theme variables.
- Use status color plus text or icon, not color alone.

### Contrast rule
- Buttons, badges, and helper toolbar keys must remain legible in both dark and light Telegram shells.

---

## 8. Proposed Changes That Are Code-Ready

### 8.1 Terminal meta bar
- Move connection badge and disconnect action out of the viewport overlay.
- Create a dedicated top bar inside the terminal panel.
- Suggested slots:
  - left: session name / target
  - center or secondary line: status
  - right: reconnect or disconnect

### 8.2 Mobile session selector
- Replace the always-open session tree with one of:
  - compact `select`
  - slide-down session drawer
  - bottom sheet
- Preferred phase-1 choice: compact `select` with a secondary “manage sessions” drawer if needed.

### 8.2A Full-screen entry/exit affordance
- Add a clear `Full screen` or expand action in the normal terminal entry point.
- In full-screen mode, replace that action with a `Back` or collapse action.
- If Telegram `BackButton` is available, mirror the same behavior there.

### 8.3 Terminal panel sizing
- Introduce a route-level height variable such as `--terminal-route-height`.
- Compute viewport height from dynamic viewport or Telegram viewport values.
- Eliminate `min-height: 400px` as the mobile default for the terminal panel.

### 8.4 Mobile helper key row
- Add a sticky helper bar directly above the Telegram tab bar.
- Buttons must be at least `44px` tall on mobile.
- Use compact capsule buttons rather than generic square admin buttons.

### 8.5 Empty and disconnected states
- Replace plain centered copy with action-led states.
- Examples:
  - empty: “Select a pane to connect”
  - disconnected: “Connection lost. Retry or switch session.”

### 8.5A Transcript presentation
- User command/input should feel lightweight and easy to follow.
- Terminal output should be grouped into readable dark monospace cards or transcript blocks.
- Long outputs should support collapse/expand behavior.
- Error blocks should be visually distinct without looking like system failure unless they actually are failures.

### 8.6 Terminal-first spacing
- Tighten chrome spacing around terminal selectors and meta bars.
- Spend saved height on the viewport, not on card padding.

---

## 9. State Model Guidance

### Empty
- no target selected
- show selector and primary action

### Connecting
- terminal meta bar visible
- loading text outside viewport

### Connected
- full viewport active
- helper keys available on mobile

### Disconnected
- viewport preserved if possible
- reconnection affordance visible

### Error
- short explicit message
- retry path or switch-session path

---

## 10. Responsive Behavior

### Desktop
- keep sidebar plus full-width terminal panel
- separate terminal header from viewport

### Tablet
- allow a narrower session column
- preserve readable typography

### Telegram / narrow mobile
- terminal route becomes terminal-first
- full-screen terminal-chat mode is available
- session switching condenses to a single-line control
- helper key row becomes available
- terminal height responds to Telegram viewport changes

---

## 11. Micro-Details Checklist

- Add visible focus states for buttons, tabs, and tree items.
- Avoid two-letter destructive labels like `DC` on mobile.
- Keep a visible in-app back affordance in full-screen mode even if Telegram back integration exists.
- Use plain text labels such as `Disconnect` or an icon plus label.
- Prevent overly long pane targets from overflowing the header; truncate with ellipsis.
- Keep terminal helper buttons visually subordinate to the main viewport.
- Make the reconnect action explicit when disconnected.
- Avoid inline one-off style drift where the same terminal elements repeat.

---

## 12. Accessibility and Edge-Case Checks

- Touch targets for mobile helper buttons and selectors must meet minimum mobile target sizing.
- Status indicators must include text, not color alone.
- Focus styles are required for keyboard and external-keyboard users.
- Light theme Telegram must preserve readable headings and secondary labels.
- Long session names and pane targets must truncate without collapsing layout.
- The bottom toolbar and Telegram tab bar must not overlap terminal content or each other.
- Full-screen exit must always remain obvious and reachable.

---

## 13. Prototype Coverage Checks

The prototype or implementation review should visibly cover:
- mobile compact session switching
- friendly terminal-chat transcript layout
- full-screen entry and exit behavior
- terminal meta bar outside the viewport
- terminal/chat surface sized to Telegram route height
- helper key toolbar on mobile
- empty, connecting, connected, and disconnected states
- long wrapped or long transcript output on a narrow screen
