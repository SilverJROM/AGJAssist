# Batch 1 UI Review

Reviewer: `jromhead`
Scope: Telegram Mini App terminal-chat implementation in `plan06`
Evidence used: confirmed requirements, UI plan, batch-1 change notes, code review of terminal files, and live app endpoint check at `http://127.0.0.1:3101`
Note: headless browser capture was attempted, but no usable screenshot artifact was produced in this environment, so this review is code/evidence-based.

## Summary

Batch 1 is directionally right. The app now has a friendly terminal-chat mode, a bottom composer, Telegram-focused full-screen scaffolding, and a raw-terminal fallback. That is the correct product move for the requirement.

The main UX problem is not the concept, it is the execution details. The friendly transcript loop is likely to churn and reinitialize too often, which will make the chat surface feel unstable. Full-screen mode also still wastes vertical space and the back-path is split across two mechanisms, which makes the focused mode feel less clean than the requirement asks for.

## Spec Compliance Check

- Friendly terminal-chat default in Telegram: present.
- Bottom composer for input: present.
- Real tmux-backed command processing: present.
- Raw terminal fallback: present.
- Full-screen terminal-chat mode: present.
- Clear back path: present, but not yet fully clean or singular.
- Transcript-style presentation: present, but still close to a log viewer in feel.

## Severity Guide

- `MAJOR`: strong friction or unstable experience that will be felt immediately.
- `MINOR`: noticeable polish or clarity issue.
- `SUGGESTION`: worthwhile improvement, not a failure.

## Findings

### 1. Transcript view is likely to churn and reinitialize on every snapshot change
- Severity: `MAJOR`
- Pillar: Usability
- Viewport: mobile and desktop
- Location: [`src/web/public/app.js:813`](../../src/web/public/app.js#L813), [`src/web/public/app.js:903`](../../src/web/public/app.js#L903)
- What is wrong: the friendly transcript effect depends on `snapshot`, and the effect body also updates `snapshot`. That means the load/poll loop can re-run every time the transcript state changes, which is a strong recipe for duplicate entries, scroll jumps, and a “flickering log” feeling.
- Expected behavior: initial load should happen once per target, and background polling should be driven by a stable effect that reads the latest snapshot from a ref or separate state channel.
- Fix recommendation: split initialization from polling, remove `snapshot` from the effect dependency list, and use a ref for the current snapshot so updates do not re-trigger the whole loader.
- Screenshot: not captured in this environment

### 2. Full-screen mode still burns vertical space and the return path feels split
- Severity: `MAJOR`
- Pillar: Navigation / Visual hierarchy
- Viewport: Telegram mobile
- Location: [`src/web/public/app.js:660`](../../src/web/public/app.js#L660), [`src/web/public/app.js:769`](../../src/web/public/app.js#L769), [`src/web/public/style.css:272`](../../src/web/public/style.css#L272), [`src/web/public/style.css:545`](../../src/web/public/style.css#L545)
- What is wrong: full-screen is implemented as a fixed overlay, but it still reserves `84px` of bottom padding even when Telegram chrome is hidden. That wastes the exact space this mode is meant to recover. The return path is also split between an inline Back button, the Telegram BackButton, and a stored previous route, so the exit behavior is functional but not yet singular or obvious.
- Expected behavior: full-screen should feel like the screen is owned by the terminal chat, with minimal dead space and one primary return path that always sends the user back predictably.
- Fix recommendation: reduce or remove the overlay bottom reserve when terminal focus mode is active, and make the back path route-driven or state-restoring rather than relying on a cached previous route plus multiple exit controls.
- Screenshot: not captured in this environment

### 3. Mobile transcript typography still reads a bit dense for chat-style use
- Severity: `MINOR`
- Pillar: Visual UX quality
- Viewport: Telegram mobile
- Location: [`src/web/public/style.css:251`](../../src/web/public/style.css#L251), [`src/web/public/style.css:486`](../../src/web/public/style.css#L486)
- What is wrong: the transcript text is readable, but it still leans toward compact terminal density rather than conversational readability. The mobile override improves it, but the overall hierarchy still feels closer to a log feed than a calm chat surface.
- Expected behavior: the friendly mode should breathe more, with slightly stronger separation between command, response, and system status.
- Fix recommendation: increase the perceived spacing between transcript blocks, keep the mobile text size closer to the upper end of the planned range, and reduce header/chrome pressure so the transcript can dominate the screen.
- Screenshot: not captured in this environment

## What Passed

- The product direction is right for the requirement.
- Raw terminal access remains available.
- Telegram-specific styling and focus mode exist.
- The composer is bottom-pinned and easy to reach.
- The UI is already much closer to a chat surface than the previous raw terminal view.

## Next Steps

1. Fix the transcript polling/reinitialization loop first.
2. Tighten full-screen height usage and make the back path singular.
3. Do one more mobile pass on transcript spacing and typography after those fixes.
