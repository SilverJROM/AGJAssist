# [driver] G1 — THE COMMIT UNDER TEST IS `4d957a0ddd130294e037c6827232637c563a8615`

Analyse EXACTLY that commit: `git show 4d957a0ddd130294e037c6827232637c563a8615`, `git diff 4d957a0ddd130294e037c6827232637c563a8615^..4d957a0ddd130294e037c6827232637c563a8615`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=4d957a0ddd130294e037c6827232637c563a8615`.

## The change under test (produced by the driver, not reported by the implementer)
```
[G1] preserve cleanup dependencies


 e2e/parent-hint-b5.spec.ts              |   50 --
 e2e/terminal-ux-sectionnav.spec.ts      |    2 +-
 src/services/agent-event-ingest.ts      |   10 +-
 src/services/agent-wake-scheduler.ts    |    4 +-
 src/services/pane-utils.ts              |   46 ++
 src/web/public/app.js                   |    2 +
 src/web/public/style.css                | 1292 ++-----------------------------
 tests/bottom-nav-helpers.test.ts        |   20 +-
 tests/command-center-cleanup.test.ts    |   56 +-
 tests/telegram-resilience.test.ts       |    2 +-
 tests/unit/agent-wake-scheduler.spec.ts |    2 +-
 11 files changed, 191 insertions(+), 1295 deletions(-)
```
```diff
diff --git a/e2e/parent-hint-b5.spec.ts b/e2e/parent-hint-b5.spec.ts
deleted file mode 100644
index fa4ab02..0000000
--- a/e2e/parent-hint-b5.spec.ts
+++ /dev/null
@@ -1,50 +0,0 @@
-import { test, expect } from '@playwright/test';
-
-test.beforeEach(async ({ page }) => {
-  await page.addInitScript(() => {
-    localStorage.setItem('agj_token', 'b5-e2e-token');
-    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'b5-e2e' }));
-  });
-});
-
-const PATH = '/index.html?b5hint=1#/overmind-projects';
-
-test('B5: Parent Session helper text in Create and Edit modals (real app.js render via static harness + real clicks, no setContent)', async ({ page }) => {
-  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
-
-  // Wait for the OVM Projects page (smoke seeds the demo card + b5hint forces load)
-  await expect(page.locator('h2:has-text("OVM Projects")')).toBeVisible({ timeout: 15000 });
-
-  // --- Reach EDIT modal via REAL clicks on actually-rendered elements ---
-  const card = page.locator('.overmind-project-card').first();
-  await expect(card).toBeVisible();
-  // real click on summary row (exercises toggleProjectExpanded)
-  await card.locator('.overmind-project-summary-row').click();
-  // real click ... menu button (exercises toggleProjectMenu)
-  await card.locator('button.overmind-project-menu-button').click();
-  // real click Edit item (exercises handleProjectMenuEdit + openEdit + conditional render)
-  await page.locator('.overmind-project-menu .context-menu-item:has-text("Edit")').click();
-
-  const editModal = page.locator('.modal:has-text("Edit OVM Project")');
-  await expect(editModal).toBeVisible();
-  const editHint = editModal.getByText(/Base name \(e\.g\. agj\) — auto-resolves to the live session/i);
-  await expect(editHint).toBeVisible();
-
-  // Close edit via real UI action (Cancel button)
-  await editModal.locator('button:has-text("Cancel")').click();
-  await expect(editModal).toBeHidden({ timeout: 5000 });
-
-  // --- Reach CREATE modal via REAL click on rendered button ---
-  await page.locator('button:has-text("+ New Project")').click();
-
-  const createModal = page.locator('.modal:has-text("New OVM Project")');
-  await expect(createModal).toBeVisible();
-  const createHint = createModal.getByText(/auto-resolves to the live session/i);
-  await expect(createHint).toBeVisible();
-
-  // Verify placeholder change (R6 part of acceptance)
-  await expect(createModal.locator('input[placeholder="agj"]')).toBeVisible();
-
-  // UI-PROOF screenshot of the rendered create form (hint visible in real DOM)
-  await createModal.screenshot({ path: 'plan/parent-autodetect/projcore-run-2026-06-21/batch-B5/screenshots/parent-hint.png' });
-});
diff --git a/e2e/terminal-ux-sectionnav.spec.ts b/e2e/terminal-ux-sectionnav.spec.ts
index 3bbc603..42288bd 100644
--- a/e2e/terminal-ux-sectionnav.spec.ts
+++ b/e2e/terminal-ux-sectionnav.spec.ts
@@ -37,7 +37,7 @@ async function installTransport(page: import('@playwright/test').Page) {
     await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '● hi\n▌ Type a message', target: TARGET, lines: 200 }) });
   });
   // catch-all for other sections we may navigate to
-  await page.route(/\/api\/(notes|tasks|projects|reminders|overmind|conversations|settings)/, async (route) => {
+  await page.route(/\/api\/(notes|tasks|projects|reminders|conversations|settings)/, async (route) => {
     await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
   });
 }
diff --git a/src/services/agent-event-ingest.ts b/src/services/agent-event-ingest.ts
index 44b31ab..74dad23 100644
--- a/src/services/agent-event-ingest.ts
+++ b/src/services/agent-event-ingest.ts
@@ -1,15 +1,7 @@
 import { readFile, stat } from "node:fs/promises";
 import path from "node:path";
 import { AgentEventRow, AgentEventsService } from "./agent-events-service.js";
-import { createHash } from "node:crypto";
-
-function hashPane(pane: string): string {
-  return createHash("sha256").update(pane).digest("hex");
-}
-
-function hasBusySignal(pane: string): boolean {
-  return /esc to interrupt|Working \(|Worked for\s+/i.test(pane);
-}
+import { hashPane, hasBusySignal } from "./pane-utils.js";
 import { TmuxService } from "../tmux/tmux-service.js";
 
 export interface AgentEventIngestRun {
diff --git a/src/services/agent-wake-scheduler.ts b/src/services/agent-wake-scheduler.ts
index 4576490..73812f5 100644
--- a/src/services/agent-wake-scheduler.ts
+++ b/src/services/agent-wake-scheduler.ts
@@ -1,9 +1,7 @@
 import { DatabaseService } from "../db/database.js";
 import { TmuxService } from "../tmux/tmux-service.js";
 import { AgentEventsService } from "./agent-events-service.js";
-function hasBusySignal(pane: string): boolean {
-  return /esc to interrupt|Working \(|Worked for\s+/i.test(pane);
-}
+import { hasBusySignal } from "./pane-utils.js";
 
 export type AgentWakeKind = "poke-pane" | "wake-coordinator";
 export type AgentWakeOutcome =
diff --git a/src/services/pane-utils.ts b/src/services/pane-utils.ts
new file mode 100644
index 0000000..f17677a
--- /dev/null
+++ b/src/services/pane-utils.ts
@@ -0,0 +1,46 @@
+import { createHash } from "node:crypto";
+
+export function hashPane(pane: string): string {
+  return createHash("sha256").update(extractBody(pane)).digest("hex");
+}
+
+export function hasActiveTurn(pane: string): boolean {
+  const statusBarChromeRe = /ctrl\+t|bypass permissions|to manage|for agents|\bshells?\b|\bmonitors?\b|shift\+tab/i;
+  return pane
+    .replace(/\r\n/g, "\n")
+    .split("\n")
+    .some((line) => /esc to interrupt/i.test(line) && !statusBarChromeRe.test(line));
+}
+
+export function hasBusySignal(pane: string): boolean {
+  return hasActiveTurn(pane) || /Working \(|Worked for\s+/i.test(pane);
+}
+
+export function extractBody(pane: string): string {
+  const lines = pane
+    .replace(/\r\n/g, "\n")
+    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
+    .split("\n")
+    .filter((line) => !isPaneChromeLine(line));
+  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
+  return lines.join("\n");
+}
+
+export function isPaneChromeLine(line: string): boolean {
+  const trimmed = line.trim();
+  const spinnerGlyphs = "◦•✻✶✢●○⎿⠋⠙⠹⠸⠼⠴⠦⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷";
+  const leadingSpinnerRe = new RegExp(`^\\s*[${spinnerGlyphs}]`, "u");
+  const statusChromeRe = /bypass permissions|ctrl\+t|to manage|for agents|\/ps to view|\/stop|\bshells?\b|\bmonitors?\b|\/model/i;
+  const modelFooterRe = /^\s*(gpt-5|sonnet|opus|haiku|claude)\b.*[·•]\s*~\//i;
+  const cwdFooterRe = /[·•]\s*~\/\S*\s*$/;
+  const turnChromeRe = /esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i;
+  return trimmed !== "" && (
+    /^[❯›]/u.test(trimmed)
+    || /^[─=]{3,}$/.test(trimmed)
+    || leadingSpinnerRe.test(line)
+    || statusChromeRe.test(line)
+    || modelFooterRe.test(line)
+    || cwdFooterRe.test(line)
+    || turnChromeRe.test(line)
+  );
+}
diff --git a/src/web/public/app.js b/src/web/public/app.js
index a453c7d..54baa83 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -467,6 +467,8 @@ function sleep(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
 }
 
+const MCP_OAUTH_RETURN_KEY = 'mcp_oauth_return';
+
 function oauthAuthorizeReturnPath(raw) {
   if (typeof raw !== 'string' || !raw) return null;
   try {
diff --git a/src/web/public/style.css b/src/web/public/style.css
index 06a0d51..af5d488 100644
--- a/src/web/public/style.css
+++ b/src/web/public/style.css
@@ -1919,1193 +1919,102 @@ body.tg-miniapp:not(.tg-light) .terminal-group-overlay {
   color: var(--text);
   font-family: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
 }
-.terminal-chat-view .ovm-chat-ts {
-  color: var(--text-secondary);
-  text-align: right;
-}
-.terminal-chat-card {
-  max-width: min(96%, 900px);
-  border-radius: 12px;
-  border: 1px solid var(--border);
-  background: var(--surface);
-  color: var(--text);
-  padding: 10px 12px;
-  box-shadow: 0 4px 16px rgba(31, 35, 40, 0.08);
-}
-.terminal-chat-entry-user .terminal-chat-card {
-  background: var(--accent-soft);
-  border-color: var(--accent-soft-border);
-}
-.terminal-chat-entry-system .terminal-chat-card {
-  background: var(--surface-2);
-}
-.terminal-chat-entry-error .terminal-chat-card {
-  background: var(--danger-card);
-  border-color: var(--danger-card-border);
-}
-.terminal-chat-meta {
-  display: flex;
-  justify-content: space-between;
-  gap: 10px;
-  font-size: 10px;
-  color: var(--text-secondary);
-  margin-bottom: 5px;
-}
-.terminal-chat-sticky-action {
-  position: sticky;
-  top: 4px;
-  z-index: 2;
-  display: flex;
-  justify-content: flex-end;
-  margin-bottom: 8px;
-  pointer-events: none;
-}
-.terminal-chat-sticky-btn {
-  pointer-events: auto;
-  background: var(--surface);
-  border-color: var(--border);
-  color: var(--text-secondary);
-  backdrop-filter: blur(6px);
-}
-/* Conversation body: single dark color on light. No token / inherit / fill war. */
-.terminal-chat-content {
-  white-space: pre-wrap;
-  word-break: break-word;
-  overflow-wrap: anywhere;
-  font-family: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
-  font-size: var(--terminal-conv-font);
-  line-height: 1.55;
-  color: var(--text);
-  letter-spacing: 0.01em;
-}
-.terminal-chat-single-output {
-  max-width: 100%;
-  min-height: 0;
-  flex: 1;
-  display: flex;
-  flex-direction: column;
-}
-.terminal-chat-single-output .terminal-chat-content {
-  flex: 1;
-  overflow: auto;
-  min-height: 0;
-}
-.terminal-chat-inline-status {
-  display: flex;
-  justify-content: flex-end;
-  margin-top: 6px;
-}
-.terminal-fullscreen-overlay {
-  position: fixed;
-  inset: 0;
-  z-index: 250;
-  background: var(--bg);
-  padding: 0;
-  overflow: hidden;
-}
-.terminal-shell-fullscreen,
-.terminal-shell-fullscreen .terminal-container,
-.terminal-shell-fullscreen .terminal-panel {
-  height: 100%;
-  min-height: 0;
-}
-
-/* Notes/Plans list */
-.item-list { display: flex; flex-direction: column; gap: 8px; }
-.item-card {
-  background: var(--surface); border: 1px solid var(--border);
-  border-radius: var(--radius); padding: 12px;
-}
-.item-card h4 { font-size: 14px; margin-bottom: 4px; }
-.item-card p { color: var(--text-secondary); font-size: 13px; }
-.item-card .meta { font-size: 11px; color: var(--text-secondary); margin-top: 8px; }
-
-/* Overmind */
-.overmind-page {
-  display: flex;
-  flex-direction: column;
-  gap: 12px;
-}
-.overmind-actions {
-  display: flex;
-  align-items: center;
-  gap: 8px;
-}
-.overmind-alert {
-  border: 1px solid rgba(248,81,73,0.35);
-  background: rgba(248,81,73,0.08);
-  color: var(--danger);
-  border-radius: var(--radius);
-  padding: 10px 12px;
-  font-size: 13px;
-}
-.overmind-project-list {
-  gap: 10px;
-}
-.overmind-project-card {
-  display: flex;
-  flex-direction: column;
-  gap: 0;
-}
-.overmind-project-summary-row,
-.overmind-project-card-header {
-  display: flex;
-  align-items: center;
-  justify-content: space-between;
-  gap: 12px;
-}
-.overmind-project-summary-row {
-  cursor: pointer;
-  min-height: 44px;
-}
-.overmind-project-summary-row:focus-visible {
-  outline: 2px solid var(--accent);
-  outline-offset: 3px;
-  border-radius: 6px;
-}
-.overmind-project-summary-main {
-  min-width: 0;
-  display: flex;
-  align-items: center;
-  gap: 8px;
-}
-.overmind-project-chevron {
-  width: 14px;
-  flex: 0 0 14px;
-  color: var(--text-secondary);
-  font-family: 'JetBrains Mono', 'Fira Code', monospace;
-  font-size: 12px;
-  text-align: center;
-}
-.overmind-project-summary-text {
-  min-width: 0;
-  display: flex;
-  flex-direction: column;
-  gap: 2px;
-}
-.overmind-project-card-header h3 {
-  font-size: 15px;
-  margin: 0;
-}
-.overmind-project-summary-text h3 {
-  font-size: 15px;
-  margin: 0;
-}
-.overmind-project-summary-text code {
-  min-width: 0;
-  color: var(--text-secondary);
-  font-family: 'JetBrains Mono', 'Fira Code', monospace;
-  font-size: 12px;
-  overflow: hidden;
-  text-overflow: ellipsis;
-  white-space: nowrap;
-}
-.overmind-project-card-actions {
-  display: flex;
-  align-items: center;
-  justify-content: flex-end;
-  gap: 6px;
-  flex-wrap: wrap;
-  flex: 0 0 auto;
-}
-.overmind-project-menu-wrap {
-  position: relative;
-}
-.overmind-project-menu-button {
-  width: 34px;
-  min-width: 34px;
-  padding-left: 0;
-  padding-right: 0;
-  font-weight: 700;
-  letter-spacing: 0;
-}
-.overmind-project-menu {
-  position: absolute;
-  top: calc(100% + 6px);
-  right: 0;
-  z-index: 120;
-  min-width: 132px;
-}
-.overmind-project-menu .context-menu-item {
-  width: 100%;
-  border: 0;
-  background: transparent;
-  text-align: left;
-}
-.overmind-project-menu .context-menu-item:disabled {
-  opacity: 0.65;
-  cursor: not-allowed;
-}
-.overmind-project-details {
-  display: flex;
-  flex-direction: column;
-  gap: 10px;
-  padding-top: 10px;
-}
-.overmind-project-warning {
-  display: flex;
-  align-items: center;
-  justify-content: space-between;
-  gap: 8px;
-  border: 1px solid rgba(210,153,34,0.45);
-  background: rgba(210,153,34,0.12);
-  color: var(--warning);
-  border-radius: var(--radius);
-  padding: 8px 10px;
-  font-size: 12px;
-}
-.overmind-project-warning span {
-  color: var(--text-secondary);
-  overflow-wrap: anywhere;
-  min-width: 0;
-}
-.overmind-project-grid {
-  display: grid;
-  grid-template-columns: repeat(2, minmax(0, 1fr));
-  gap: 10px;
-}
-.overmind-project-field {
-  min-width: 0;
-  display: flex;
-  flex-direction: column;
-  gap: 2px;
-}
-.overmind-project-field span {
-  color: var(--text-secondary);
-  font-size: 11px;
-  text-transform: uppercase;
-  letter-spacing: 0;
-}
-.overmind-project-field strong,
-.overmind-project-field code {
-  min-width: 0;
-  color: var(--text);
-  font-size: 13px;
-  overflow-wrap: anywhere;
-}
-.overmind-project-field code {
-  font-family: 'JetBrains Mono', 'Fira Code', monospace;
-}
-.overmind-tabs {
-  display: inline-flex;
-  align-self: flex-start;
-  gap: 4px;
-  padding: 3px;
-  border: 1px solid var(--border);
-  border-radius: 7px;
-  background: var(--surface);
-}
-.overmind-tab {
-  appearance: none;
-  border: 1px solid transparent;
-  border-radius: 5px;
-  background: transparent;
-  color: var(--text-secondary);
-  cursor: pointer;
-  font: inherit;
-  font-size: 13px;
-  line-height: 1.2;
-  min-height: 30px;
-  padding: 6px 10px;
-}
-.overmind-tab.active {
-  border-color: var(--border);
-  background: var(--bg);
-  color: var(--text);
-}
-.overmind-tab-error {
-  color: #f85149;
-}
-.overmind-tab-error.active {
-  border-color: rgba(248,81,73,0.34);
-  background: rgba(248,81,73,0.12);
-  color: #f85149;
-}
-.overmind-completed-controls {
-  align-items: center;
-  color: var(--text-secondary);
-  display: inline-flex;
-  gap: 8px;
-  font-size: 13px;
-}
-.overmind-completed-select {
-  background: var(--surface);
-  border: 1px solid var(--border);
-  border-radius: 5px;
-  color: var(--text);
-  font: inherit;
-  min-height: 30px;
-  padding: 4px 8px;
-  width: auto;
-  min-width: 64px;
-}
-.ovm-console {
-  border: 1px solid var(--border);
-  border-radius: var(--radius);
-  background: var(--surface);
-  min-height: 520px;
-  display: flex;
-  flex-direction: column;
-  overflow: hidden;
-}
-.ovm-console-header {
-  display: flex;
-  justify-content: space-between;
-  align-items: center;
-  gap: 12px;
-  padding: 12px;
-  border-bottom: 1px solid var(--border);
-  background: var(--bg);
-}
-.ovm-console-title {
-  display: flex;
-  align-items: center;
-  gap: 10px;
-  min-width: 0;
-}
-.ovm-console-title h3 {
-  margin: 0 0 2px;
-  font-size: 15px;
-}
-.ovm-console-title div div {
-  color: var(--text-secondary);
-  font-size: 12px;
-  overflow-wrap: anywhere;
-}
-.ovm-console-actions {
-  display: flex;
-  align-items: center;
-  gap: 8px;
-  flex-wrap: wrap;
-  justify-content: flex-end;
-}
-.ovm-status-dot {
-  width: 10px;
-  height: 10px;
-  border-radius: 999px;
-  flex: 0 0 auto;
-  background: var(--text-secondary);
-  box-shadow: 0 0 0 3px rgba(139,148,158,0.14);
-}
-.ovm-status-dot.open {
-  background: var(--success);
-  box-shadow: 0 0 0 3px rgba(63,185,80,0.16);
-}
-.ovm-status-dot.closed {
-  background: var(--danger);
-  box-shadow: 0 0 0 3px rgba(248,81,73,0.14);
-}
-.ovm-open-prompt {
-  flex: 1;
-  display: flex;
-  flex-direction: column;
-  justify-content: center;
-  align-items: center;
-  gap: 10px;
-  padding: 32px;
-  text-align: center;
-}
-.ovm-open-prompt h3 {
-  margin: 0;
-  font-size: 18px;
-}
-.ovm-open-prompt p {
-  margin: 0;
-  color: var(--text-secondary);
-  max-width: 420px;
-}
-.ovm-live-shell {
-  flex: 1;
-  min-height: 0;
-  display: flex;
-  flex-direction: column;
-}
-.ovm-stream-meta {
-  display: flex;
-  align-items: center;
-  gap: 8px;
-  padding: 10px 12px;
-  color: var(--text-secondary);
-  font-size: 12px;
-  border-bottom: 1px solid var(--border);
-}
-.ovm-transcript {
-  --terminal-fg: #e6edf3;
-  --terminal-muted: #9aa4b2;
-  flex: 1;
-  min-height: 360px;
-  overflow-y: auto;
-  display: flex;
-  flex-direction: column;
-  gap: 12px;
-  padding: 16px;
-  color: var(--terminal-fg);
-  background: linear-gradient(180deg, rgba(10,14,20,0.98), rgba(13,17,23,0.99));
-}
-.ovm-transcript div,
-.ovm-transcript span {
-  color: inherit;
-}
-.ovm-output-card {
-  max-width: 100%;
-}
-/* ===== OVM Chat: Telegram-style ===== */
-.ovm-chat-messages {
-  flex: 1;
-  min-height: 360px;
-  overflow-y: auto;
-  display: flex;
-  flex-direction: column;
-  gap: 6px;
-  padding: 12px 16px;
-  /* Telegram soft green chat background */
-  background:
-    linear-gradient(160deg, #c8e6c9 0%, #b2dfb2 40%, #a5d6a7 100%);
-}
-.ovm-chat-empty {
-  text-align: center;
-  color: rgba(0,0,0,0.45);
-  font-size: 13px;
-  margin: auto;
-  padding: 24px;
-}
-
-/* Rows */
-.ovm-chat-row {
-  display: flex;
-  align-items: flex-end;
-}
-.ovm-chat-row-user {
-  justify-content: flex-end;
-}
-.ovm-chat-row-ovm {
-  justify-content: flex-start;
-}
-.ovm-chat-row-system {
-  justify-content: center;
-  margin: 6px 0;
-}
-
-/* System/error pill (Telegram date-separator style) */
-.ovm-chat-pill {
-  display: inline-block;
-  background: rgba(0,0,0,0.28);
-  color: #fff;
-  font-size: 11px;
-  padding: 3px 12px;
-  border-radius: 999px;
-  max-width: 80%;
-  text-align: center;
-  word-break: break-word;
-}
-
-/* Bubbles shared */
-.ovm-chat-bubble {
-  max-width: 78%;
-  padding: 8px 12px 6px 12px;
-  border-radius: 14px;
-  font-size: 14px;
-  line-height: 1.5;
-  word-break: break-word;
-  white-space: pre-wrap;
-  position: relative;
-  box-shadow: 0 1px 2px rgba(0,0,0,0.14);
-}
-
-/* Bubble tail geometry is shared; fill colors stay scoped so Terminal
-   chat and OVM cannot fight over background/text. */
-.ovm-chat-bubble-ovm::after {
-  content: '';
-  position: absolute;
-  bottom: 0;
-  left: -7px;
-  width: 0;
-  height: 0;
-  border-style: solid;
-  border-width: 0 0 10px 8px;
-}
-.ovm-chat-bubble-user::after {
-  content: '';
-  position: absolute;
-  bottom: 0;
-  right: -7px;
-  width: 0;
-  height: 0;
-  border-style: solid;
-  border-width: 0 8px 10px 0;
-}
-
-/* OVM / incoming: white bubble, bottom-left tail.
-   Scoped to the OVM transcript so these light rules cannot leak
-   into Terminal chat (which has its own light theme). */
-.ovm-chat-messages .ovm-chat-bubble-ovm {
-  background: #ffffff;
-  color: #111;
-  border-bottom-left-radius: 4px;
-}
-.ovm-chat-messages .ovm-chat-bubble-ovm::after {
-  border-color: transparent transparent #ffffff transparent;
-}
-
-/* User / outgoing: light-green bubble, bottom-right tail */
-.ovm-chat-messages .ovm-chat-bubble-user {
-  background: #effdde;
-  color: #111;
-  border-bottom-right-radius: 4px;
-}
-.ovm-chat-messages .ovm-chat-bubble-user::after {
-  border-color: transparent #effdde transparent tra
... TRUNCATED at 20000 chars. This is a display bound, NOT the scope of your review — read the rest with `git show 4d957a0ddd130294e037c6827232637c563a8615` before judging.
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/G1-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=G1 attempt=2 marker=DRV-G1-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
