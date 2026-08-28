F4 validator red-team a2

Target commit:
`7c9b5ae20072a122bd2598108255a122a8a5f18d`

Focused command:
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-header.spec.ts --project=cc`

Focused result: PASS, but the focused spec is still only a body-visible smoke test.

Lens 1 - render integrity:
The adversarial 390x844 probe loaded six literal sessions, clicked the first terminal row, and the detail view did not render. `F4-dom-aria-a2.json` captured `pageErrors:["TypeError: i.push is not a function"]` and the page remained on the terminal list with six rows. The header branch introduced by this commit cannot be reached cleanly through the public UI path.

Lens 2 - collapse mechanism completeness:
The diff declares `tabsCollapsed`, `utilitiesCollapsed`, and `controlsTucked`, but `controlsTucked` is never read and `setControlsTucked` is never called. There is no `data-testid="controls-collapse"` mechanism, so the required independent control collapse/tuck state is absent.

Lens 3 - utilities collapse trap:
The only utility toggle is rendered inside `<div data-testid="utilities" style=${utilitiesCollapsed ? 'display:none' : ''}>`. After clicking it, the control hides itself along with the chips. The visible bell indicator has no click handler or expand affordance, so utilities cannot be independently restored through the header chrome.

Lens 4 - tabs duplication:
When `tabsCollapsed` becomes false, the new `agent-group-switcher` inside `terminal-header-v2` renders and the old legacy `agent-group-switcher` below it also renders because it is gated by the same `!tabsCollapsed`. Expanding tabs therefore duplicates the sibling switcher instead of porting the mockup chrome.

Lens 5 - test discrimination:
`e2e/command-center-header.spec.ts` still routes auth, opens `/index.html#/terminals`, waits one second, and asserts only `body` visibility. It does not enter a terminal detail view, supply literal group/reminder/wakeup/summary fixtures, click the collapse controls, or assert one-row collapsed geometry.

Verdict: FAIL. H1/H2 have no OG criterion text in the brief, so this validation uses the F4 scope text as the authority.
