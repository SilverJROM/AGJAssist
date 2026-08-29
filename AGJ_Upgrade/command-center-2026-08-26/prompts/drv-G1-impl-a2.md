# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] G1 CORRECTION (attempt 2) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

F8 LANDED (advance-F8.marker, commit d70d12c, PASS). Checked the 'A4 migration criterion conflicts with UI scope' note in F8's callback before clearing this -- it is NOT the mockup-vs-do-not-regress conflict north flagged as an escalation trigger: the redteam pass explains it as an ACCEPTANCE-ID COLLISION (og-requirements.md's 'A4' text elsewhere describes an unrelated database criterion; the slice scope, naming the terminal mobile regression, was correctly used as authority instead) and explicitly confirms 'the locked final 390px mockup keeps the compact controls visible by default' -- no mockup/contract conflict, nothing to escalate. Retry your own gate (npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts) and re-verify A4/A6/A7 yourself against d70d12c rather than trusting F8's report alone.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed G1: defect_class=DELETION_COLLATERAL gate=None.
**Validator's callback summary:** [projcore callback] validator G1 STATUS: DONE — FAIL OVM teardown correct but deletion collateral broke 4 green suites

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# G1 attempt 1 — validator prescription (marker DRV-G1-21)

commit under test: `41f51e9cc7b8de894b27c82a52a7cb9406cfb680`
verdict: **FAIL** · failed_gate: **A5** · defect_class: **DELETION_COLLATERAL**

**What PASSED (do not re-do it):** A1 verified in a real browser — `#/overmind` redirects home,
`#/overmind-projects` / `#/ovm` / `#/workflows` render "Page not found", bottom nav is
Home/Tasks/Notes/Terminal/Settings, zero `[class*=overmind]` nodes (`validation/G1-a1-dom.txt`,
`G1-a1-home-nav.png`, `G1-a1-overmind-route.png`). A2 verified against a real boot on :3399 —
server starts clean, every `/api/overmind/*` + `/api/app-settings` returns 404, no overmind
wiring anywhere in `src/`. A3 verified through the real `AssistantCore.handleCommand()` — all
seven commands return "Unknown command. Use /help.". `tsc --noEmit` lost ~20 dangling overmind
TS2307 errors (only 3 pre-existing unrelated errors remain). The focused tests in the row all
pass (2 vitest, 28 playwright). **The failures below are all deletion collateral: live code and
live callers that went out with the dead code.**

---

FINDING 1 of 10
WHAT FAILED: `e2e/mcp-oauth.spec.ts:158` — "AC-6 login/TOTP then finishWebLogin returns only to
same-origin /oauth/authorize". Passes at `41f51e9^`, fails deterministically at `41f51e9`
(reproduced twice): `page.waitForURL(/\/oauth\/authorize\?/)` times out; the browser lands on
`/index.html` instead. Cause: the app.js gutting deleted the line
`const MCP_OAUTH_RETURN_KEY = 'mcp_oauth_return';` because it sat directly under the
`overmind-task-duration` helper block (parent app.js:597). Its two readers survived —
`src/web/public/app.js:488` and `:489` inside `finishWebLogin()`. The reference now throws
ReferenceError, and it throws inside `try { ... } catch {}`, so it is **silent**: `returnTo`
stays null and `finishWebLogin` falls through to `location.reload()`. Real-user impact: after
an MCP OAuth login the consent screen is never restored.
THE FIX: re-add `const MCP_OAUTH_RETURN_KEY = 'mcp_oauth_return';` at module scope in
`src/web/public/app.js`, immediately above `function oauthAuthorizeReturnPath` (currently line
469). Nothing else in that function changed.
WHY THE LAST ATTEMPT MISSED IT: the deleted constant was adjacent to overmind code, not part of
it, and its only consumers read it inside a swallow-everything `catch {}`.

FINDING 2 of 10
WHAT FAILED: `src/services/agent-wake-scheduler.ts:4` — the inlined `hasBusySignal` is NOT the
function it replaced. Original (`src/services/overmind/pane-utils.js` at `41f51e9^`) was
`hasActiveTurn(pane) || /Working \(|Worked for\s+/i.test(pane)`, where `hasActiveTurn` splits
the pane into lines and **masks status-bar chrome lines** (`ctrl+t`, `bypass permissions`,
`to manage`, `for agents`, `shells`, `monitors`, `shift+tab`) before testing for
"esc to interrupt". The inlined version is a flat regex over the whole pane with no masking.
Proven with the original module loaded from git as a second path — specimen: an IDLE pane whose
only "esc to interrupt" is the Claude Code footer help line
(`? for shortcuts · esc to interrupt · ctrl+t to manage · shift+tab for agents`):
original `hasBusySignal` → `false`, HEAD → `true`. At the call site
`agent-wake-scheduler.ts:149` that means every scheduled wake against an idle Claude Code pane
is written off as `skipped-busy` and **never fires**.
THE FIX: do not inline a rewritten regex. Move the real `hasActiveTurn` + `hasBusySignal` pair
(line-split + `statusBarChromeRe` mask) into a neutral non-OVM module — e.g.
`src/services/pane-utils.ts`, a verbatim port of the deleted `pane-utils.js` minus the OVM
comments — and import `hasBusySignal` from there in both `agent-wake-scheduler.ts` and
`agent-event-ingest.ts`.

FINDING 3 of 10
WHAT FAILED: `src/services/agent-event-ingest.ts:6` — the inlined `hashPane` is
`sha256(pane)`; the original was `sha256(extractBody(pane))`, which first strips ANSI, spinner
glyphs, the status bar, model/cwd footers, turn-indicator lines and trailing blanks. The
deleted file's own comment states the contract: "ignores chrome/spinner lines so the hash only
changes when real body text changes." Proven against the original as a second path — two pane
snapshots with an identical body differing only in `⠋ Working (12s)` vs `⠙ Working (13s)`:
original hashes are EQUAL, HEAD hashes DIFFER. At `agent-event-ingest.ts:192-211` a differing
hash resets `lastActivityMs` and clears `emittedIdleDone` on every poll, so the
`nowMs - lastActivityMs >= idleAfterActivityMs` branch at :213-217 can never be reached while a
spinner is animating — **`idle-done` agent events stop being emitted**.
THE FIX: same module as FINDING 2 — port `extractBody` and `isPaneChromeLine` verbatim
alongside, and make `hashPane` hash `extractBody(pane)` again. Do not simplify the chrome
regexes; they are the behaviour.

FINDING 4 of 10
WHAT FAILED: `tests/bottom-nav-helpers.test.ts` no longer loads at all —
`Error: Failed to load url ../src/web/public/overmind-helpers.js ... Does the file exist?`
The slice deleted `src/web/public/overmind-helpers.js` but left line 14 of that spec importing
it. This is exactly the orphan the Scope line names ("so no orphan import survives"). Whole
suite goes from collected to failed-to-collect. Green at `41f51e9^`, red at `41f51e9`.
THE FIX: repoint the import at line 14 to `../src/web/public/nav-helpers.js` (which exports the
same `AVAILABLE_BOTTOM_NAV_TABS` / `addBottomNavTab` / `getBottomNavTabs` /
`serializeBottomNavTabIds` / `deserializeBottomNavTabIds` / `readBottomNavTabIds` /
`writeBottomNavTabIds` / `BOTTOM_NAV_STORAGE_KEY` surface), then update the assertions at
lines 47-64: `/overmind` is no longer an available tab id, so `addBottomNavTab(..., '/overmind')`
must be expected to be REJECTED and `getBottomNavTabs(['/overmind'])` to fall back to
`DEFAULT_BOTTOM_NAV_TAB_IDS`. Use a surviving id (`/terminals`) for the add/move/persist cases.

FINDING 5 of 10
WHAT FAILED: `tests/unit/agent-wake-scheduler.spec.ts:43` —
`expect(send).toHaveBeenCalledWith("agent:0.0", "overmind: Scheduled wake is due for batch A3b. …")`
but the slice changed `WAKE_NUDGE_PREFIX` (`src/services/agent-wake-scheduler.ts:41`) from
`"overmind: Scheduled wake is due"` to `"Scheduled wake is due"` without touching the spec.
Green at `41f51e9^`, red at `41f51e9`.
THE FIX: drop the `overmind: ` prefix from the expected string at
`tests/unit/agent-wake-scheduler.spec.ts:45`. The production change is correct — de-branding the
nudge is in scope; the stale assertion is the defect.

FINDING 6 of 10
WHAT FAILED: `tests/telegram-resilience.test.ts:46` — expects
`"Telegram bot startup failed; API, dashboard, and Overmind watcher remain online:"`, but
`src/startup/telegram-resilience.ts:87` now logs
`"Telegram bot startup failed; API and dashboard remain online:"`. Same shape as FINDING 5.
Green at `41f51e9^`, red at `41f51e9`.
THE FIX: update the expected literal at `tests/telegram-resilience.test.ts:47` to the new
string. (Note the second arg is also a plain string, not a matcher, in the actual call — keep
`expect.stringContaining("RequestError")`, which still matches.)

FINDING 7 of 10
WHAT FAILED: `e2e/parent-hint-b5.spec.ts` is a residual dead-OVM spec that the slice did not
delete. It navigates to `/index.html?b5hint=1#/overmind-projects` and asserts
`h2:has-text("OVM Projects")` + `.overmind-project-card` + `.overmind-project-menu-button` —
all of which G1 removed. **This one was ALREADY red at `41f51e9^`, so it is not a G1
regression** — but the Scope line is "delete residual dead OVM source/tests/tools", G1 deleted
`e2e/command-center-ovm.spec.ts` and `e2e/command-center-ovm-fence.spec.ts`, and missed this
third one.
THE FIX: `git rm e2e/parent-hint-b5.spec.ts`. Also drop `overmind` from the mock-route alternation
at `e2e/terminal-ux-sectionnav.spec.ts:40` — that catch-all now names an API that cannot exist.

FINDING 8 of 10
WHAT FAILED: `src/web/public/style.css` still carries **108 dead `.overmind-*` selectors** out
of 117 `.overmind|.ovm` classes present. Residual OVM artifacts, which the Scope line names.
THE FIX: delete only the 108 with no reference in `src/web/public/*.js` / `*.html`. **Do NOT
blanket-delete on the `ovm` prefix** — 9 classes are LIVE and used by the terminal chat
(`ovm-chat-text`, `ovm-chat-row`, `ovm-chat-row-user`, `ovm-chat-row-ovm` at
`src/web/public/app.js:2489, 2520, 2530, 2542, 3473`); removing those unstyles the chat
transcript. Regenerate the dead list with:
`grep -oE '\.(overmind|ovm)[A-Za-z0-9_-]*' src/web/public/style.css | sort -u` then filter out
every class that greps in `src/web/public/*.js`.

FINDING 9 of 10
WHAT FAILED: `tests/command-center-cleanup.test.ts` (the spec this slice authored) is not
discriminating for the Scope's own stated goal. It asserts (a) 16 paths do not exist and
(b) five literal substrings are absent from `app.js` / `server.ts`. Nothing in it can fail on a
surviving reference to a deleted module — which is why FINDING 1 and FINDING 4 both shipped
green. It cannot fail on any of findings 1-4.
THE FIX: add a third `it()` that scans callers rather than files. Concretely: for each deleted
module basename (`overmind-helpers`, `overmind-routes`, `overmind-stream-manager`,
`ovm-session`, `app-settings-service`, `nudge-state-service`, `overmind/pane-utils`), grep
`src/**`, `tests/**`, `e2e/**` for an `import`/`from` mentioning it and assert zero hits; and
assert `src/web/public/app.js` declares every module-scope identifier it references by checking
that each `SCREAMING_SNAKE` identifier used in the file has a matching
`^(const|let|var)\s+<NAME>` declaration. The second half is what catches
`MCP_OAUTH_RETURN_KEY`; a file-existence list never will.

FINDING 10 of 10
WHAT FAILED: PLAN_DEFECT — AC **A5** and the Scope paragraph contradict each other. A5 requires
"the full unit + e2e suites are green"; the Scope says "Full unit+e2e stay on B8/F7, not this
row." They cannot both be honoured, and the row's `tests` command runs neither full suite. For
the record, measured both ways at `41f51e9` vs `41f51e9^`:
unit — parent 32 failed files / 15 failed tests, HEAD 9 failed files / 15 failed tests (G1 cleared
23 broken overmind suites — a large net win); e2e chromium — parent 18 failed / 80 passed, HEAD
18 failed / 77 passed. **The pre-existing failures below are NOT attributed to G1 and must not be
charged to the next attempt:** `tests/agent-wakeup-routes.test.ts`, `tests/mcp-migration.test.ts`
(x3), `tests/telegram-commands.test.ts` (broken by ccc0bdd [B5], which removed the commands from
the `setMyCommands` menu while the spec still asserts them), `tests/unit/agent-reminder-schema.spec.ts`
(x2), `tests/unit/command-center-migration.spec.ts` (x2), `tests/unit/database.spec.ts` (x4), and
the whole `command-center-*-fence` / `command-center-window-fence` / `terminal-ux-header-tabs`
e2e set. Exactly **four** suites regressed under G1: `mcp-oauth` AC-6 (e2e),
`bottom-nav-helpers`, `unit/agent-wake-scheduler`, `telegram-resilience`.
THE FIX: for this row, fix findings 1-9 and re-run
`npx vitest run tests/command-center-cleanup.test.ts tests/bottom-nav-helpers.test.ts tests/unit/agent-wake-scheduler.spec.ts tests/telegram-resilience.test.ts --minWorkers=1 --maxWorkers=4`
plus `npx playwright test e2e/mcp-oauth.spec.ts e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`.
Then ask north to reword A5 to "no suite that was green before this slice is red after it" —
an absolute-green clause on a row explicitly scoped away from the full suites will fail every
attempt regardless of the work.

---
## Mechanism chosen where the criterion stated only an outcome
A5 says "the full unit + e2e suites are green" (an outcome) without saying how a cleanup slice
proves it did not break anything. **Mechanism I used: differential baselining.** Every suite was
run twice — once at `41f51e9`, once in a `git worktree` at `41f51e9^` with `

[driver] ⚠ PRESCRIPTION TRUNCATED at 12000 chars — 0 further finding(s) are in /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/G1-fix-a1.md. READ THAT FILE before you finish.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(G1): <summary>` or `[G1] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer G1 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
PROMOTION CLEANUP: delete residual dead OVM source/tests/tools and `mockups/final/*.r1..r4.html`, `PROMPT-*.txt`, `grok-run-*.log`; keep `mockups/final/agent-window-v2.html`. Targeted cleanup test plus served-browser terminal regressions so no orphan import survives. Full unit+e2e stay on B8/F7, not this row. Per-slice temp cleanup is already each row's isolated runner, not this janitor.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **A1** — The mini-app no longer exposes Overmind: the **Workflows**, **Overmind Projects**, and **OVM Console** screens and their bottom-nav entries are gone; no route renders them (navigating there 404s / redirects home).
- **A2** — The `/api/overmind/*` routes and the `overmind-stream-manager` WebSocket are removed; the server boots clean with no overmind service wiring (`overmind-watcher`, `overmind/` brain, notifications) instantiated.
- **A3** — The bot no longer registers `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end`; sending them yields the normal unknown-command path.
- **A5** — After teardown the app boots, the terminal/chat + notes/plans/tasks/reminders surfaces work, and the full unit + e2e suites are green (no dangling overmind imports/types).

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx vitest run tests/command-center-cleanup.test.ts --minWorkers=1 --maxWorkers=4 && npx playwright test e2e/terminal-ux-conversation.spec.ts e2e/terminal-ux-groups.spec.ts e2e/terminal-ux-control.spec.ts`
