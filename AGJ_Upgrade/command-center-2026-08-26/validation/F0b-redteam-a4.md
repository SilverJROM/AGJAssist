F0b validator red-team a4

commit under test: 9e35ea852351f9285b549531e297439dfe77e225
focused command: FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs

Result: PASS

Lens 1 - exact commit and harness-only scope
PASS. `git show` and `git diff 9e35ea852351f9285b549531e297439dfe77e225^..9e35ea852351f9285b549531e297439dfe77e225` show one changed file, `e2e/command-center-window-fence.spec.ts`. No product UI code changed.

Lens 2 - focused execution and collection
PASS. The exact focused command exited 0. `fence-report-v1.json` has schema `fence-report-v1`, collects all G1 through J2, passes all ten ids, and has an empty `failed` array.

Lens 3 - F0b explicit harness mechanisms
PASS. `check()` awaits assertions; `openAgentWindow()` waits for primary, secondary, and any extra sibling tmux sessions through `/api/tmux/sessions`; H1 asserts default tabs-collapsed state before reveal clicks; reveal clicks are limited to G2/J1/J2 setup; J2 uses `[data-testid="terminal-header-tab"]`; setup failures are mapped into named failures; and cleanup is protected by finally even when `finishContributor()` throws.

Lens 4 - H3 theme discrimination
PASS. H3 now uses literal light and dark Telegram WebApp `themeParams`, stubs the external Telegram SDK request so the fixture survives until `app.js`, drives the registered `themeChanged` handler, and asserts product-owned DOM/CSS outputs rather than synthesizing a value from class absence or `matchMedia`.

Lens 5 - J2 scrubber and switch discrimination
PASS. J2 creates extra sibling sessions to force overflow, asserts the wide switcher and scrubber are visible, pointer-drags the scrubber and verifies `scrollLeft` increases, then clicks a non-active `[data-testid="terminal-header-tab"]` and verifies the visible session name changes to that literal tab label.

Note: HARNESS-SMOKE has no standalone og-requirements text; this verdict treats the F0b scope text and plan row as the authority.
