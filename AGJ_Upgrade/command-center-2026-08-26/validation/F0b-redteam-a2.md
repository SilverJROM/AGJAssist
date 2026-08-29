F0b validator red-team a2

commit under test: 85f715fda13664ce788657d36b8b0f759ce9f5dd
focused command: FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs

Result: FAIL after red-team

Lens 1 - exact commit and scope
PASS. `git show` and `git diff 85f715fda13664ce788657d36b8b0f759ce9f5dd^..85f715fda13664ce788657d36b8b0f759ce9f5dd` show one changed file, `e2e/command-center-window-fence.spec.ts`. No product UI code was changed by this commit.

Lens 2 - focused execution
PASS. After clearing stale `f7-*` tmux sessions, the exact focused command exited 0. `fence-report-v1.json` contains schema `fence-report-v1`, collected G1 through J2, passed all ten ids, and failed none.

Lens 3 - required F0b mechanisms
PASS. The diff keeps `await assertion()` in `check()`, waits for both primary and secondary tmux session names through `/api/tmux/sessions`, asserts H1 default tabs-collapsed before reveal clicks, calls `ensureTabsExpandedIfNeeded()` only before G2/J1/J2, and uses `[data-testid="terminal-header-tab"]` for J2 with a supported `count()` plus `toBeGreaterThan(0)`.

Lens 4 - H3 discrimination
FAIL. H3 no longer proves the product theme attribute. If `document.documentElement.getAttribute("data-theme")` is null, the assertion returns `light` or `dark` from `matchMedia` and passes. Static inspection of `src/web/public/app.js` finds no `documentElement.setAttribute("data-theme", ...)` path, so this fallback masks the exact failure seen in attempt 1.

Lens 5 - failure-path robustness
PARTIAL. Moving `finishContributor()` into finally ensures happy-path contributors write the report, but setup failures before the first `check()` still produce no named G1-J2 failure in the report. Checked assertion failures also make `finishContributor()` throw before the tmux cleanup loop, which can leak `f7-*` sessions.
