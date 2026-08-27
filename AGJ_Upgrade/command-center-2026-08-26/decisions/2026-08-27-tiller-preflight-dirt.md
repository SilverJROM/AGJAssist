# Decision — preflight dirt isolation before tiller start

Date: 2026-08-27 · `[projcore]`

Sol#6 refuses any porcelain outside the run dir. This repo had 183 dirty paths, almost all prior
AGJ_Upgrade runs and untracked logs. None are this effort.

- Stashed 3 TRACKED mods as `stash@{0}` `cc-tiller-preflight-tracked-dirt` (`playwright.config.ts` + two
  2026-06-13 batch-B5 notes). Restore after the drain if still wanted.
- Hid remaining UNTRACKED non-run-dir paths via `.git/info/exclude` (not a working-tree edit). Marker
  `# BEGIN cc-tiller-preflight-exclude`. Does not commit ignore rules into the product.

Porcelain after: only `?? AGJ_Upgrade/command-center-2026-08-26/` which Sol#6 allows.
