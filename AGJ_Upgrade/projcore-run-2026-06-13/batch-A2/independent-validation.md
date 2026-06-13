# Batch A2 Independent Validation

## Validation Summary

Validated the R20 outcomes against the implemented files and automated tests.

## Checks

- Registry exists as a single app-owned typed source in `src/config/providers.ts`.
- Registry seeds `grok`, `codex`, and `claude` with launch templates, bypass flags, effort metadata, callback mechanisms, worktree metadata, session suffixes, models, bands, and role eligibility.
- Resolver exposes the two required paths:
  - `resolveAgentLaunchSpec(agent)` for provider/model/effort to launch spec.
  - `resolveProviderModelForRoleBand({ role, band })` for eligible model selection.
- Dummy provider test proves a provider can be added by extending registry data without modifying resolver logic.
- `PROVIDERS.md` is derived from the TypeScript registry and was checked for exact generated consistency.

## Evidence

- `npx vitest run tests/unit/provider-resolver-service.spec.ts`: PASS, 4 tests.
- `npm run build`: PASS.
- `npx vitest run`: PASS, 43 files, 583 tests, 1 skipped.

## Residual Risk

Launcher integration is intentionally not wired in this batch; B3 will consume this resolver with the A1 agent assignment output.
