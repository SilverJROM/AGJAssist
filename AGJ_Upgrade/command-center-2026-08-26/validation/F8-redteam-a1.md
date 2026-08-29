F8 validator red-team pass, attempt 1

Commit under test: d70d12cd6783dfcf713e2d1c052c1bfd7257a07c

Scope interpretation:
- A4's listed database criterion does not describe this slice; the slice scope names
  the terminal/chat mobile regression as authority.
- A6 and A7 have no criterion text in og-requirements.md per the brief; the scope is
  the authority for those ids.

Diff lenses:
- Functional reachability: the mobile CSS no longer hides `.cc-ctrl-items`, so font
  controls, ME navigation, summaries, and settings remain reachable at 390px.
- Layout/cascade: the 390px header becomes a two-row grid with target/utilities
  above switcher/controls; DOM evidence shows `scrollWidth` equals `clientWidth`.
- Mockup parity: the locked final 390px mockup keeps the compact controls visible by
  default and reserves the collapse toggle for optional tucking.
- Raw chrome: the existing menu switch remains available and DOM evidence confirms
  raw output exposes the stripped CLI chrome.
- Regression surface: focused conversation, groups, and control specs all pass under
  the mandated Playwright command.

Result: standard-clean.
