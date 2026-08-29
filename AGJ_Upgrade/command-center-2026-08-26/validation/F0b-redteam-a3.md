F0b validator red-team a3

commit under test: 58ad5f391bc09af57328bcc49be9d9f416cd941f
focused command: FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs

Result: FAIL after red-team

Lens 1 - exact commit and product-code scope
PASS. `git show` and `git diff 58ad5f391bc09af57328bcc49be9d9f416cd941f^..58ad5f391bc09af57328bcc49be9d9f416cd941f` show one changed file, `e2e/command-center-window-fence.spec.ts`. This is harness-only; no product UI code was changed.

Lens 2 - focused execution and report collection
PASS. The exact focused command exited 0. `fence-report-v1.json` has schema `fence-report-v1`, collects G1 through J2, passes all ten ids, and has an empty `failed` array.

Lens 3 - previous harness fixes
PASS. `check()` awaits assertions, `openAgentWindow()` waits for both primary and secondary tmux sessions, H1 checks the default hidden switcher before reveal clicks, reveal clicks are limited to G2/J1/J2 setup, J2 uses `[data-testid="terminal-header-tab"]`, setup failures are mapped into named failures, and tmux cleanup is protected by an inner finally after report emission.

Lens 4 - H3 discrimination
FAIL. H3 computes `"dark"` from the absence of `body.tg-light` and accepts it. That means a product that never applies theme state can still pass H3. OG H3 requires light/dark to follow device setting and stay readable, so the harness needs literal light and dark inputs and product-owned output assertions.

Lens 5 - J2 discrimination
FAIL. J2 asserts only visible switcher plus tab count. It does not require `[data-testid="agent-group-switcher-scrubber"]`, does not drag it, and does not click a wide tab to prove the same active-agent switch action as the dropdown path. OG J2 explicitly requires the working draggable scrubber and identical switch behavior.
