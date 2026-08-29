# [driver] G1 — THE COMMIT UNDER TEST IS `41f51e9cc7b8de894b27c82a52a7cb9406cfb680`

Analyse EXACTLY that commit: `git show 41f51e9cc7b8de894b27c82a52a7cb9406cfb680`, `git diff 41f51e9cc7b8de894b27c82a52a7cb9406cfb680^..41f51e9cc7b8de894b27c82a52a7cb9406cfb680`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=41f51e9cc7b8de894b27c82a52a7cb9406cfb680`.

## The change under test (produced by the driver, not reported by the implementer)
```
[G1] remove residual Overmind artifacts


 .../mockups/final/PROMPT-r2.txt                    |   20 -
 .../mockups/final/PROMPT-r3.txt                    |   22 -
 .../mockups/final/PROMPT-r4.txt                    |   21 -
 .../mockups/final/PROMPT-r5.txt                    |   29 -
 .../mockups/final/agent-window-v2.r1.html          | 1667 ------------
 .../mockups/final/agent-window-v2.r2.html          | 1714 ------------
 .../mockups/final/agent-window-v2.r3.html          | 1767 -------------
 .../mockups/final/agent-window-v2.r4.html          | 1826 -------------
 .../mockups/final/grok-run-r2.log                  |   10 -
 .../mockups/final/grok-run-r3.log                  |    9 -
 .../mockups/final/grok-run-r4.log                  |    9 -
 .../mockups/final/grok-run-r5.log                  |    9 -
 .../mockups/final/grok-run.log                     |    9 -
 e2e/command-center-ovm-fence.spec.ts               |   81 -
 e2e/command-center-ovm.spec.ts                     |   31 -
 src/api/routes/app-settings-routes.ts              |   84 -
 src/api/routes/overmind-routes.ts                  | 1644 ------------
 src/api/server.ts                                  |   18 +-
 src/api/websocket/overmind-stream-manager.ts       |   91 -
 src/bot/assistant-core.ts                          |  143 +-
 src/bot/telegram-bot.ts                            |    6 +-
 src/config/config.ts                               |    6 -
 src/index.ts                                       |   14 -
 src/services/agent-event-ingest.ts                 |   10 +-
 src/services/agent-wake-scheduler.ts               |    6 +-
 src/services/app-settings-service.ts               |  179 --
 src/services/nudge-state-service.ts                |  225 --
 src/services/overmind/pane-utils.js                |   59 -
 src/services/ovm-session.ts                        |  309 ---
 src/startup/telegram-resilience.ts                 |    2 +-
 src/tools/propose-overmind-projects.ts             |  493 ----
 src/web/public/app.js                              | 1486 +----------
 src/web/public/overmind-helpers.js                 |  334 ---
 .../overmind-projects-api.acceptance.test.ts       |  549 ----
 .../overmind-projects-migration.acceptance.test.ts |  346 ---
 tests/app-settings-service.spec.ts                 |  151 --
 tests/command-center-cleanup.test.ts               |   44 +
 tests/nudge-state-service.spec.ts                  |  128 -
 tests/overmind-agent-pane.test.ts                  |  114 -
 tests/overmind-brain.test.ts                       |  416 ---
 tests/overmind-classifier-batch-alias.test.ts      |   80 -
 tests/overmind-classifier.test.ts                  |  514 ----
 tests/overmind-command-removal.test.ts             |   81 -
 tests/overmind-commands.test.ts                    |  276 --
 tests/overmind-completeness.test.ts                |  352 ---
 tests/overmind-cooldowns.test.ts                   |   43 -
 tests/overmind-decision.test.ts                    |  265 --
 tests/overmind-fixtures.ts                         |   72 -
 tests/overmind-notifications.test.ts               |  104 -
 tests/overmind-nudge.test.ts                       | 1992 --------------
 tests/overmind-parent-brain.test.ts                |  134 -
 tests/overmind-parent-live-resolve.test.ts         |  100 -
 tests/overmind-parent-nudge-guard.test.ts          |  237 --
 tests/overmind-parent-session-resolver.test.ts     |  118 -
 tests/overmind-project-migration.test.ts           |  272 --
 tests/overmind-reconcile.test.ts                   |  343 ---
 tests/overmind-registration-journey.test.ts        |  258 --
 tests/overmind-removal-api.test.ts                 |  132 -
 tests/overmind-removal-bootstrap.test.ts           |   42 -
 tests/overmind-removal-services.test.ts            |   20 -
 tests/overmind-routes.test.ts                      | 2714 --------------------
 tests/overmind-sanitize.test.ts                    |   70 -
 tests/overmind-service.test.ts                     | 1230 ---------
 tests/overmind-stream.test.ts                      |  490 ----
 tests/overmind-subagent.test.ts                    |  544 ----
 tests/overmind-task-staleness.test.ts              |  179 --
 tests/ovm-session.test.ts                          |  193 --
 67 files changed, 66 insertions(+), 24870 deletions(-)
```
```diff
diff --git a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r2.txt b/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r2.txt
deleted file mode 100644
index a5c5958..0000000
--- a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r2.txt
+++ /dev/null
@@ -1,20 +0,0 @@
-You are grok46 making ONE surgical, incremental change to the EXISTING agent-window v2 final mockup. Do NOT redesign or regress anything. Do NOT rewrite from scratch — edit the existing file in place.
-
-READ the current mockup (this is the file you will MODIFY IN PLACE):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-
-THE CHANGE (owner request, verbatim): "include a collapse/expand on the wakeup/reminders as well so that i can minimize them on the header as well if needed, the tabs (other agents) is auto minimized, and the reminder is auto expanded."
-
-Do EXACTLY this, nothing more:
-1) Add a collapse/expand control for the UTILITY CHIP ROW (the reminders / wakeup / summaries chips — `.cc-util-row`), mirroring the EXISTING agent-tabs collapse pattern (a small toggle + a compact collapsed pill). Collapsed = the util row minimizes into the header; expand restores it. When collapsed, still show a tiny hint so a PENDING WAKEUP or ACTIVE REMINDER is not fully hidden (e.g. a compact "⏰" / count + a dot). Keep it visually consistent with the tabs collapse.
-2) Change the DEFAULT load state: the AGENT TABS strip starts COLLAPSED (auto-minimized); the UTILITY/REMINDERS row starts EXPANDED (auto-expanded). (Currently tabs default expanded and the util row is always shown — flip to: tabs collapsed, util expanded.)
-3) Keep the two collapses INDEPENDENT — each with its own toggle.
-
-PRESERVE EVERYTHING ELSE EXACTLY: the drag-resize harness + all tablet/desktop responsive rules (data-band gating), the 3-state Light/System/Dark theme, and every interaction (reminders folder+per-agent flags+cadence+repeat, wakeup + clearing pending chip, summaries dropdown, endpoints, agent scrubber, draft-kept, key row, send modes, font A-/A+, ME-nav, search, image attach). The 390px phone must remain identical to now EXCEPT the two new default states and the new util-collapse control.
-
-Write the result back to the SAME path (overwrite):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-Append a short note to:
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/rationale.md
-describing the util-row collapse + the two new default states.
-When done, print the file path.
diff --git a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r3.txt b/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r3.txt
deleted file mode 100644
index 3859786..0000000
--- a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r3.txt
+++ /dev/null
@@ -1,22 +0,0 @@
-You are grok46 making ONE surgical, incremental change to the EXISTING agent-window v2 final mockup. Do NOT redesign or regress anything. Edit IN PLACE — do not rewrite from scratch.
-
-READ (the file you will MODIFY IN PLACE):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-
-OWNER REQUEST (verbatim): "when i minimize the reminders have them have like just 1 row and just have it as just [a] clickable icon on top and try to reduce the sizes of the gear icons, up down/ font sizing or even have the a way to collapse them as well basically when all of the things are collapsed its only 1 row."
-
-GOAL: when the header's collapsible sections are all collapsed, the header renders as EXACTLY ONE ROW.
-
-Do this, and only this:
-1) COLLAPSED UTIL/REMINDERS = a single small clickable ICON inline on the TOP header row — NOT a second row. Currently, collapsing the reminders/util row leaves a thin second row holding a pill. Change it so the collapsed representation is one compact icon button that lives in the row-1 control cluster (keep a minimal pending hint on it: a small dot if a reminder is active, a tiny count if a wakeup is pending). Tapping it expands the util row back to its normal full second row. Expanded behavior + default (util EXPANDED on load) stays unchanged.
-2) SHRINK the row-1 controls so row 1 stays clean with the extra icons: the gear (settings) button, the ME up/down nav, and the font A-/A+ pill — reduce their sizes/padding (touch targets may shrink toward ~28px). Keep them usable.
-3) OPTIONAL (only if it stays clean and simple): let the font/ME/gear control cluster collapse too — e.g. tuck them behind a single overflow entry — so the header can reach a truly minimal single row.
-4) NET RESULT: with the agent tabs collapsed AND the util/reminders collapsed (and controls tucked if you added #3), the header is ONE ROW. Keep the DEFAULT load state as-is: tabs collapsed, reminders/util EXPANDED (so a fresh load shows row-1 + the reminders row).
-
-PRESERVE everything else exactly: the drag-resize harness + tablet/desktop band rules, the 3-state Light/System/Dark theme, and every interaction (reminders folder+flags+cadence+repeat, wakeup + clearing pending chip, summaries dropdown, endpoints, agent scrubber, draft-kept, key row, send modes, font, ME-nav, search, image attach), plus the two independent collapses. The 390px phone must stay visually identical EXCEPT these density changes and the collapsed-util-as-single-icon behavior.
-
-Write back to the SAME path (overwrite):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-Append a short note to:
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/rationale.md
-When done, print the file path.
diff --git a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r4.txt b/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r4.txt
deleted file mode 100644
index 1ede06d..0000000
--- a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r4.txt
+++ /dev/null
@@ -1,21 +0,0 @@
-You are grok46 making ONE surgical, incremental change to the EXISTING agent-window v2 final mockup. Do NOT redesign or regress anything. Edit IN PLACE — do not rewrite from scratch.
-
-READ (the file you will MODIFY IN PLACE):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-
-OWNER REQUEST (verbatim): "the chat does not auto-update on the sessions details text when i sometimes go talk to the agent directly on the session it does not carry over to the change, can we also have on the chat a refresh button to basically repull all the details from the session into the chat?"
-
-CONTEXT: in the real app, the chat view can DRIFT from the live tmux session — if the user interacts with the agent directly on the session (outside the mini-app), the chat's transcript AND the session detail/status text do not update. The fix is a manual REFRESH that re-pulls the whole session state into the chat.
-
-Do this, and only this:
-1) Add a REFRESH control (a ↻ / circular-arrow icon button) reachable from the CHAT AREA — place it so it stays visible regardless of header collapse state (e.g. next to the existing search magnifier at the top-right of the transcript, or as a small pill in the transcript area). It must NOT clutter the single-row-collapsed header. Give it a clear title/aria-label like "Refresh from session".
-2) On tap (MOCK behavior, since there is no backend): simulate re-pulling the session — briefly show a spinning/refreshing state on the icon, then re-render the transcript and UPDATE the header detail/status text (the "zsh · updated ..." subtitle and the status dot) to reflect a fresh pull (e.g. set the "updated" time to now, and you may append or refresh the latest line to demonstrate that new activity from a direct session interaction is now reflected). Finish with a brief "Refreshed" toast. Keep it obviously a mock (no real network).
-3) Works across phone / tablet / desktop and light / dark; keyboard-focusable; respects the existing visual language.
-
-PRESERVE everything else exactly: drag-resize harness + tablet/desktop bands, 3-state theme, the one-row-collapsed header (tabs + util-icon + controls-tuck), the independent collapses and their defaults (tabs collapsed, reminders expanded), and every interaction (reminders/wakeup/summaries/endpoints/scrubber/draft-kept/keys/send modes/font/ME-nav/search/attach). The 390px phone must stay visually identical EXCEPT the added refresh control.
-
-Write back to the SAME path (overwrite):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-Append a short note to:
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/rationale.md
-When done, print the file path.
diff --git a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r5.txt b/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r5.txt
deleted file mode 100644
index 5f49d19..0000000
--- a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r5.txt
+++ /dev/null
@@ -1,29 +0,0 @@
-You are grok46 making ONE surgical, incremental change to the EXISTING agent-window v2 final mockup. Do NOT redesign or regress anything. Edit IN PLACE — do not rewrite from scratch.
-
-READ (the file you will MODIFY IN PLACE):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-
-OWNER REQUEST (verbatim): "fix the ui the drag button on the agent list is gone, also on a phone view since the ui is so small can we just have a dropdown on the agent list for the group rather than the current ui that is draggable, make the draggable only applicable on desktop view, on tablet maybe but if the tablet has small view make it dropdown as well."
-
-THE CHANGE — make the GROUP AGENT SWITCHER responsive by frame width, and fix the missing drag control:
-
-1) BELOW ~900px frame width (phone + narrow tablet): the group agent switcher is a DROPDOWN. A single compact control shows the current agent (name + status dot) with a caret; tapping opens a dropdown LIST of the group's agents (each row: status dot, name, a small dot if it holds an unsent draft, highlight the current one); tap a row to switch; close on select or tap-outside. NO horizontal drag strip, NO drag scrubber at these widths (too small to use).
-
-2) AT/ABOVE ~900px frame width (wide tablet + desktop): the horizontal agent-tab strip + the DRAGGABLE scrubber — restored and VISIBLE and working. The drag scrubber is currently missing/hidden; make sure it renders and drags correctly in this width band.
-
-3) So: draggable = desktop / wide tablet only; dropdown = phone / narrow tablet. Use the resize-harness frame width (the same value that drives data-band) to switch between the two presentations, and re-evaluate on resize so dragging the frame across ~900px swaps the control live.
-
-4) Both presentations must call the SAME switchAgent() and keep current-agent highlighting + per-agent draft indicators. Keep the collapse/expand behavior sensible: at phone/narrow widths the dropdown IS the compact control (no separate tab-strip row); at desktop the strip + its collapse toggle behave as before.
-
-PRESERVE everything else EXACTLY, including recent additions:
-- The ↻ REFRESH-from-session button (added last pass) — keep it.
-- The one-row-collapsed header (collapsed util = single bell icon on row 1; gear/ME/font shrunk; controls tuck to ⋯).
-- The drag-RESIZE harness (right-edge + corner handles) and all tablet/desktop [data-band] rules.
-- The 3-state Light/System/Dark theme; the independent collapses and their defaults (tabs collapsed, reminders expanded).
-- Every interaction: reminders (folder+per-agent flags+cadence+repeat), wakeup + clearing chip, summaries dropdown, endpoints, draft-kept, key row, send modes, font, ME-nav, search, image attach.
-
-Write back to the SAME path (overwrite):
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html
-Append a short note to:
-/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/mockups/final/rationale.md
-Use Chromium/Playwright if available to verify: (a) at 390px the switcher is a dropdown that opens and switches; (b) at 1280px the drag scrubber is visible and drags; (c) dragging the frame across ~900px swaps the control. When done, print the file path.
diff --git a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r1.html b/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r1.html
deleted file mode 100644
index 7c4bcc5..0000000
--- a/AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r1.html
+++ /dev/null
@@ -1,1667 +0,0 @@
-<!doctype html>
-<html lang="en">
-<head>
-<meta charset="utf-8" />
-<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
-<title>AGJAssist — Agent Window v2 (final · sonnet5 + resize)</title>
-<style>
-/* =========================================================================
-   AGJAssist — Agent Window v2 — final (sonnet5 base + drag-resize)
-   Self-contained single-file mockup. No backend, no external deps.
-   Reuses the REAL app's class names (terminal-shell, terminal-chat-*, ovm-chat-*,
-   terminal-sheet-*, terminal-header-tab, terminal-control-bar, badge, toast, …)
-   verbatim wherever the element already exists in src/web/public/{style.css,app.js},
-   so this file doubles as a literal CSS/markup reference for the port.
-   New v2 surfaces use a `cc-` (command-center) prefix so a builder can tell at a
-   glance what's existing-contract vs. new-in-this-mockup.
-   ========================================================================= */
-
-/* ---------- harness chrome (NOT part of the app contract — reviewer tool) ---------- */
-:root {
-  --harness-bg: #05070a;
-  --harness-fg: #cdd6e0;
-  --harness-border: #263041;
-  --harness-accent: #58a6ff;
-  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
-  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "JetBrains Mono", monospace;
-}
-* { box-sizing: border-box; }
-html, body {
-  margin: 0; padding: 0; background: var(--harness-bg); color: var(--harness-fg);
-  font-family: var(--sans); -webkit-tap-highlight-color: transparent;
-}
-.cc-harness-bar {
-  position: sticky; top: 0; z-index: 500;
-  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
-  padding: 10px 14px;
-  background: #0a0e16; border-bottom: 1px solid var(--harness-border);
-}
-.cc-harness-title { font-size: 13px; font-weight: 700; color: #fff; margin-right: auto; white-space: nowrap; }
-.cc-harness-title small { display: block; font-weight: 400; color: #7f8ea3; font-size: 10.5px; margin-top: 1px; }
-.cc-harness-group { display: inline-flex; align-items: center; gap: 4px; background: #10151f; border: 1px solid var(--harness-border); border-radius: 999px; padding: 3px; }
-.cc-harness-group span.lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7686; padding: 0 8px 0 4px; }
-.cc-harness-btn {
-  border: 0; background: transparent; color: #9fb0c3; font-size: 12px; font-weight: 600;
-  padding: 6px 11px; border-radius: 999px; cursor: pointer; font-family: inherit;
-}
-.cc-harness-btn.sel { background: var(--harness-accent); color: #05070a; }
-.cc-harness-btn:not(.sel):hover { color: #fff; }
-.cc-stage { display: flex; justify-content: center; padding: 34px 28px 80px; }
-.cc-phone-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 100%; }
-.cc-phone-label { font-size: 11px; color: #6b7686; font-family: var(--mono); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
-.cc-band-pill {
-  display: inline-flex; align-items: center; font-family: var(--sans); font-size: 10px; font-weight: 700;
-  letter-spacing: .06em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
-  background: #10151f; border: 1px solid var(--harness-border); color: #9fb0c3;
-}
-.cc-band-pill[data-band="Phone"] { color: #7ee787; border-color: #238636; }
-.cc-band-pill[data-band="Tablet"] { color: #d2a8ff; border-color: #8957e5; }
-.cc-band-pill[data-band="Desktop"] { color: var(--harness-accent); border-color: #1f6feb; }
-.cc-resize-hint { font-family: var(--sans); font-size: 10.5px; color: #5b6778; }
-.cc-frame-shell {
-  position: relative;
-  width: var(--frame-w, 390px);
-  height: var(--frame-h, 780px);
-  max-width: calc(100vw - 56px);
-  max-height: calc(100vh - 180px);
-  flex: 0 0 auto;
-}
-.cc-frame-shell.anim { transition: width .25s ease, height .25s ease; }
-.cc-phone {
-  width: 100%; height: 100%;
-  border-radius: 20px; overflow: hidden; position: relative;
-  box-shadow: 0 30px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04);
-}
-.cc-resize-e {
-  position: absolute; top: 18px; bottom: 28px; right: -12px; width: 16px;
-  cursor: ew-resize; touch-action: none; z-index: 20;
-  display: flex; align-items: center; justify-content: center;
-  background: transparent; border: 0; padding: 0;
-  appearance: none; -webkit-appearance: none;
-}
-.cc-resize-e-bar {
-  width: 6px; height: 56px; border-radius: 999px; pointer-events: none;
-  background: #2b3a4d; border: 1px solid var(--harness-accent);
-  box-shadow: 0 0 0 3px rgba(88,166,255,0.16);
-}
-.cc-resize-e:hover .cc-resize-e-bar,
-.cc-frame-shell.is-resizing-x .cc-resize-e-bar { background: var(--harness-accent); }
-.cc-resize-se {
-  position: absolute; right: -6px; bottom: -6px; width: 24px; height: 24px;
-  cursor: nwse-resize; touch-action: none; z-index: 21;
-  border-radius: 6px; background: #0a0e16; border: 1px solid var(--harness-accent);
-  color: var(--harness-accent); display: flex; align-items: center; justify-content: center;
-  box-shadow: 0 4px 12px rgba(0,0,0,0.4); padding: 0;
-  appearance: none; -webkit-appearance: none;
-}
-.cc-resize-se:hover,
-.cc-frame-shell.is-resizing-xy .cc-resize-se { background: var(--harness-accent); color: #05070a; }
-.cc-live-size {
-  position: absolute; right: 18px; bottom: 18px; z-index: 22;
-  background: #0a0e16; color: #fff; border: 1px solid var(--harness-accent);
-  font-family: var(--mono); font-size: 11px; padding: 5px 8px; border-radius: 8px;
-  pointer-events: none; display: none; white-space: nowrap;
-  box-shadow: 0 8px 20px rgba(0,0,0,0.4);
-}
-.cc-frame-shell.is-resizing .cc-live-size { display: block; }
-.cc-notes {
-  width: min(700px, calc(100vw - 24px));
-  background: #10151f; border: 1px solid var(--harness-border); border-radius: 12px;
-  color: #b9c4d3; font-size: 12.5px; line-height: 1.6;
-}
-.cc-notes summary { cursor: pointer; padding: 11px 14px; font-weight: 700; color: #fff; list-style: none; display: flex; align-items: center; gap: 8px; }
-.cc-notes summary::-webkit-details-marker { display: none; }
-.cc-notes summary::before { content: '▸'; color: var(--harness-accent); transition: transform .15s; }
-.cc-notes[open] summary::before { transform: rotate(90deg); }
-.cc-notes-body { padding: 0 16px 14px; }
-.cc-notes-body b { color: #fff; }
-.cc-notes-body ul { margin: 6px 0 12px 18px; padding: 0; }
-.cc-notes-body li { margin-bottom: 4px; }
-
-/* ============================= APP CONTRACT ============================= */
-/* Everything below `.cc-phone` down to the endpoints sheet is the buildable
-   agent-window-v2 surface. Light tokens are the base; dark + system react
-   via [data-theme] exactly like the real app's terminal-shell gating. */
-.cc-phone {
-  --bg: #f6f8fa; --surface: #ffffff; --surface-2: #eef1f4; --border: #d0d7de;
-  --text: #1f2328; --text-secondary: #57606a; --accent: #0969da;
-  --success: #1a7f37; --warning: #9a6700; --danger: #cf222e;
-  --on-accent: #ffffff; --pressed: #eaeef2; --pressed-2: #e2e8ee; --idle: #8c959f;
-  --grip: #c8d1da; --grip-active: #9aa4ae;
-  --
... TRUNCATED at 20000 chars. This is a display bound, NOT the scope of your review — read the rest with `git show 41f51e9cc7b8de894b27c82a52a7cb9406cfb680` before judging.
```

# tiller validator — standing contract
(This section is identical in every validator brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the VALIDATOR. **Write NO product code** (verifier != fixer). You judge, independently.

---

# THE SLICE — G1 (run command-center-2026-08-26)

## Scope (do ONLY this)
PROMOTION CLEANUP: delete residual dead OVM source/tests/tools and `mockups/final/*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`; keep `mockups/final/agent-window-v2.html`. Targeted cleanup test plus served-browser terminal regressions so no orphan import survives. Full unit+e2e stay on B8/F7, not this row. Per-slice temp cleanup is already each row's isolated runner, not this janitor.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A1** — The mini-app no longer exposes Overmind: the **Workflows**, **Overmind Projects**, and **OVM Console** screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
- **A2** — The `/api/overmind/*` routes and the `overmind-stream-manager` WebSocket are removed; the server boots clean with no overmind service wiring (`overmind-watcher`, `overmind/` brain, notifications) instantiated.
- **A3** — The bot no longer registers `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end`; sending them yields the normal unknown-command path.
- **A5** — After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the full unit + e2e suites are green (no dangling overmind imports/types).

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx vitest run tests/command-center-cleanup.test.ts --minWorkers=1 --maxWorkers=4 && npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=G1 attempt=1 role=validator
  marker=DRV-G1-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate G1 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator G1 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/G1-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
**One block per finding that is NOT A CLEAN PASS — including PARTIAL. If N things failed or partially failed, write N blocks** — numbered, in the order you would fix them. Do NOT collapse them to the most important one. Only a lens that passed CLEANLY gets no block:
```
FINDING 1 of <N>
WHAT FAILED: <the specific assertion/behaviour, and where>
THE FIX: <the concrete change that would make this pass>
WHY THE LAST ATTEMPT MISSED IT: <one line, optional>

FINDING 2 of <N>
WHAT FAILED: ...
THE FIX: ...
```
**A finding you leave out can cost a FULL ATTEMPT CYCLE to rediscover** — an implementer turn, a validator turn and the callback latency — to learn something already written on disk. A strong seat sometimes infers past the omission; do not rely on the next seat being that seat. The gate id below stays singular because it names ONE gate; your prescription must not.
**NAME A MECHANISM, NOT AN OUTCOME.** A call, a path, a specimen, a structure, a flag — not the property the change should have. *"Tests must fail when the clause is violated"* is an OUTCOME and is worth nothing to the next seat; *"the negative specimen's NAME must contradict its shape"* is a mechanism and closed the slice. That distinction is not stylistic: a slice spent FOUR attempts each inventing a different mechanism for one question — zero-arg call, bytecode scan, object() sentinel, MagicMock sentinel — while the fix sat unwritten, and closed on the first attempt that had it. **The next implementer sees this file VERBATIM and sees your callback line only as a summary; if the fix is not in the file, it does not reach them.**
`[VERDICT-V1] run=command-center-2026-08-26 batch=G1 attempt=1 marker=DRV-G1-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
